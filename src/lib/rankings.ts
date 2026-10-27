import { transaction } from "../db";

export async function rebuildRankings() {
  await transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('shipkudos-rankings'))",
    );
    for (const period of [7, 30]) {
      const id = crypto.randomUUID();
      await client.query(
        "INSERT INTO ranking_snapshots(id,period) VALUES($1,$2)",
        [id, period],
      );
      await client.query(
        `INSERT INTO ranking_entries(snapshot_id,profile_id,position,score,commits,prs,issues,reviews,active_days)
        SELECT $1,id,rank() OVER(ORDER BY score DESC)::int,score,commits,prs,issues,reviews,active_days FROM (
          SELECT p.id,coalesce(sum(d.commits+d.prs+d.issues+d.reviews),0)::int score,coalesce(sum(d.commits),0)::int commits,coalesce(sum(d.prs),0)::int prs,coalesce(sum(d.issues),0)::int issues,coalesce(sum(d.reviews),0)::int reviews,count(d.day) FILTER(WHERE d.commits+d.prs+d.issues+d.reviews>0)::int active_days
          FROM profiles p LEFT JOIN daily_stats d ON d.profile_id=p.id AND d.day>=(now() AT TIME ZONE 'UTC')::date-($2::int-1) AND d.day<=(now() AT TIME ZONE 'UTC')::date
          WHERE p.published_at IS NOT NULL AND p.hidden_at IS NULL AND p.last_sync_at>now()-interval '48 hours' GROUP BY p.id
        ) totals`,
        [id, period],
      );
      await client.query(
        `INSERT INTO rank_history(day,period,profile_id,position,score) SELECT (now() AT TIME ZONE 'UTC')::date,$2,profile_id,position,score FROM ranking_entries WHERE snapshot_id=$1 ON CONFLICT(day,period,profile_id) DO UPDATE SET position=excluded.position,score=excluded.score`,
        [id, period],
      );
      await client.query(
        "DELETE FROM ranking_snapshots WHERE period=$1 AND id NOT IN(SELECT id FROM ranking_snapshots WHERE period=$1 ORDER BY created_at DESC LIMIT 2)",
        [period],
      );
    }
  });
}
