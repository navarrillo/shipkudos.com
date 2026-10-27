import { PgBoss } from "pg-boss";
import { sql, transaction } from "../db";
import { HttpError } from "./errors";
let promise: Promise<PgBoss> | undefined;
export function getQueue() {
  promise ??= (async () => {
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    boss.on("error", () =>
      console.error(JSON.stringify({ event: "queue_error" })),
    );
    await boss.start();
    return boss;
  })();
  return promise;
}
export async function enqueueSync(id: string, manual = false) {
  if (manual)
    await transaction(async (client) => {
      const result = await client.query(
        "SELECT published_at,hidden_at,last_requested_at FROM profiles WHERE id=$1 FOR UPDATE",
        [id],
      );
      const profile = result.rows[0];
      if (!profile?.published_at || profile.hidden_at)
        throw new HttpError(409, "profile_not_published");
      const remaining = profile.last_requested_at
        ? 3600 -
          Math.floor(
            (Date.now() - new Date(profile.last_requested_at).getTime()) / 1000,
          )
        : 0;
      if (remaining > 0) throw new HttpError(429, "sync_cooldown", remaining);
      await client.query(
        "UPDATE profiles SET last_requested_at=now(),next_sync_at=now() WHERE id=$1",
        [id],
      );
    });
  const boss = await getQueue();
  await boss.send(
    "github-sync",
    { profileId: id },
    {
      singletonKey: id,
      priority: manual ? 10 : 0,
      retryLimit: 4,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
    },
  );
}
export async function publishProfile(id: string) {
  const newlyPublished = await transaction(async (client) => {
    const {
      rows: [profile],
    } = await client.query(
      "SELECT published_at,hidden_at FROM profiles WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!profile || profile.hidden_at)
      throw new HttpError(409, "profile_unavailable");
    if (profile.published_at) return false;
    await client.query(
      "UPDATE profiles SET published_at=now(),next_sync_at=now() WHERE id=$1",
      [id],
    );
    return true;
  });
  if (newlyPublished) await enqueueSync(id);
}
export async function revokeDelegates(id: string) {
  await sql(
    "UPDATE agent_credentials SET revoked_at=now() WHERE owner_id=$1 AND revoked_at IS NULL",
    [id],
  );
  await sql("DELETE FROM agent_registrations WHERE owner_id=$1", [id]);
}
