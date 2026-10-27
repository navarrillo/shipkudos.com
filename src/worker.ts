import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { requireProductionConfig } from "./lib/config";
import { sql, getPool } from "./db";
import { syncGitHub } from "./lib/github";
import { rebuildRankings } from "./lib/data";
const env = requireProductionConfig(),
  instance = randomUUID();
const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  max: 3,
  migrate: false,
  createSchema: false,
  schedule: false,
  supervise: true,
});
boss.on("error", () =>
  console.error(JSON.stringify({ event: "worker_queue_error" })),
);
await boss.start();
const [previousHealth] = await sql(
  "SELECT progress_at FROM worker_health WHERE id='main'",
);
let stopping = false,
  progress: Date | null = previousHealth?.progress_at || null,
  lastRank = 0,
  lastClean = 0;
const stop = () => {
  stopping = true;
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await boss.work<{ profileId: string }>(
  "github-sync",
  { batchSize: 2, pollingIntervalSeconds: 2 },
  async (jobs) => {
    await Promise.all(
      jobs.map(async (job) => {
        await syncGitHub(job.data.profileId);
        progress = new Date();
      }),
    );
  },
);
try {
  while (!stopping) {
    const due = await sql(
      "SELECT id FROM profiles WHERE published_at IS NOT NULL AND hidden_at IS NULL AND sync_state<>'reconnect' AND (next_sync_at IS NULL OR next_sync_at<=now()) ORDER BY last_sync_at NULLS FIRST LIMIT 100",
    );
    for (const row of due)
      await boss.send(
        "github-sync",
        { profileId: row.id },
        { singletonKey: row.id, priority: row.last_sync_at ? 0 : 10 },
      );
    if (Date.now() - lastRank > 900000) {
      await rebuildRankings();
      lastRank = Date.now();
    }
    if (Date.now() - lastClean > 3600000) {
      await sql(
        "UPDATE agent_registrations SET state='expired' WHERE expires_at<now() AND state IN ('pending','approved')",
      );
      await sql(
        "DELETE FROM agent_registrations WHERE expires_at<now()-interval '24 hours'",
      );
      await sql(
        "DELETE FROM daily_stats WHERE day<(now() AT TIME ZONE 'UTC')::date-59",
      );
      await sql(
        "DELETE FROM rank_history WHERE day<(now() AT TIME ZONE 'UTC')::date-29",
      );
      await sql(
        "DELETE FROM ad_events WHERE created_at<now()-interval '48 hours'",
      );
      await sql("DELETE FROM ad_daily WHERE day<current_date-366");
      await sql("DELETE FROM rate_limits WHERE expires_at<now()");
      await sql(
        "DELETE FROM sync_runs WHERE finished_at<now()-interval '30 days'",
      );
      lastClean = Date.now();
    }
    const [queue] = await sql(
      "SELECT min(start_after) AS oldest FROM pgboss.job WHERE name='github-sync' AND state IN ('created','retry') AND start_after<now()",
    );
    await sql(
      `INSERT INTO worker_health(id,instance_id,revision,heartbeat_at,oldest_runnable_at,progress_at) VALUES('main',$1,$2,now(),$3,$4) ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id,revision=excluded.revision,heartbeat_at=now(),oldest_runnable_at=excluded.oldest_runnable_at,progress_at=excluded.progress_at`,
      [instance, env.APP_SHA, queue?.oldest || null, progress],
    );
    for (let i = 0; i < 30 && !stopping; i++)
      await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  await boss.stop({ graceful: true, timeout: 25000 });
  await sql("DELETE FROM worker_health WHERE id='main' AND instance_id=$1", [
    instance,
  ]);
  await getPool().end();
}
