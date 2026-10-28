import { transaction } from "../db";

/** Periodic rebuild. Unchanged from the original worker interval. */
export const RANK_REBUILD_INTERVAL_MS = 900_000;
/** Minimum gap after the previous rebuild before a sync can trigger another. */
export const RANK_REBUILD_AFTER_SYNC_MS = 60_000;

export type RankState = {
  /** Epoch ms of the last completed rebuild. 0 means this process has not rebuilt yet. */
  lastRank: number;
  /** Successful github-sync jobs observed by this process. */
  syncs: number;
  /** `syncs` value included in the last rebuild. A gap means rankings are dirty. */
  covered: number;
};

/** Mark rankings dirty only when syncGitHub stored a ready profile. */
export function recordGitHubSync(state: RankState, completed: boolean) {
  if (completed) state.syncs += 1;
}

export function rankingsDue(state: RankState, now: number) {
  const elapsed = now - state.lastRank;
  const dirty = state.syncs !== state.covered;
  return (
    elapsed > RANK_REBUILD_INTERVAL_MS ||
    (dirty && elapsed >= RANK_REBUILD_AFTER_SYNC_MS)
  );
}

/**
 * Rebuild when the 15-minute interval has elapsed, or when a successful sync
 * is waiting and the last rebuild was at least 60 seconds ago.
 * `covered` stays behind `syncs` if another sync finishes during the rebuild,
 * so that sync is not cleared until a later pass.
 */
export async function rebuildRankingsIfDue(
  state: RankState,
  now: number,
  rebuild: () => Promise<void> = rebuildRankings,
) {
  if (!rankingsDue(state, now)) return false;
  const seen = state.syncs;
  await rebuild();
  if (state.covered < seen) state.covered = seen;
  state.lastRank = now;
  return true;
}

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
