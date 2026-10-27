import { unstable_cache } from "next/cache";
import { sql } from "../db";
import { config } from "./config";
import { HttpError } from "./http";
import { signPayload, verifyPayload } from "./crypto";

export type Profile = {
  id: string;
  github_id: string;
  login: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  tools: string[];
  x_handle: string;
  published_at: Date | null;
  hidden_at: Date | null;
  last_sync_at: Date | null;
  sync_state: string;
  sync_error: string | null;
  last_requested_at: Date | null;
  next_sync_at: Date | null;
};
export type RankedProfile = Profile & {
  position: number;
  score: number;
  commits: number;
  prs: number;
  issues: number;
  reviews: number;
  active_days: number;
  snapshot_id: string;
};
export async function ownProfile(id: string) {
  return (await sql<Profile>("SELECT * FROM profiles WHERE id=$1", [id]))[0];
}
export async function latestRankingAt() {
  const [row] = await sql<{ created_at: Date | null }>(
    "SELECT max(created_at) AS created_at FROM ranking_snapshots",
  );
  return row?.created_at ?? null;
}
export async function leaderboard(
  period: number,
  search = "",
  cursor?: string,
  snapshotId?: string,
) {
  if (!process.env.DATABASE_URL)
    return {
      entries: [] as RankedProfile[],
      snapshot: null,
      nextCursor: null as string | null,
    };
  const decoded = cursor
    ? verifyPayload<{
        snapshot: string;
        offset: number;
        period: number;
        search: string;
      }>(cursor)
    : null;
  if (
    cursor &&
    (!decoded ||
      decoded.period !== period ||
      decoded.search !== search ||
      decoded.offset < 0 ||
      decoded.offset > 1000000)
  )
    throw new HttpError(409, "ranking_updated_restart_pagination");
  const [snapshot] = await sql<{ id: string; created_at: Date }>(
    "SELECT id,created_at FROM ranking_snapshots WHERE period=$2 AND ($1::uuid IS NULL OR id=$1::uuid) ORDER BY created_at DESC LIMIT 1",
    [decoded?.snapshot || snapshotId || null, period],
  );
  if (!snapshot) {
    if (cursor) throw new HttpError(409, "ranking_updated_restart_pagination");
    return {
      entries: [] as RankedProfile[],
      snapshot: null,
      nextCursor: null as string | null,
    };
  }
  const entries = await sql<RankedProfile>(
    `SELECT p.id,p.github_id,p.login,p.name,p.avatar,p.tools,p.last_sync_at,e.* FROM ranking_entries e JOIN profiles p ON p.id=e.profile_id
    WHERE e.snapshot_id=$1 AND p.published_at IS NOT NULL AND p.hidden_at IS NULL AND p.last_sync_at>now()-interval '48 hours' AND (p.login ILIKE $2 OR p.name ILIKE $2)
    ORDER BY e.position,p.github_id LIMIT 51 OFFSET $3`,
    [
      snapshot.id,
      `%${search.replace(/[\\%_]/g, "\\$&")}%`,
      decoded?.offset || 0,
    ],
  );
  const more = entries.length > 50;
  return {
    entries: entries.slice(0, 50),
    snapshot,
    nextCursor: more
      ? signPayload({
          snapshot: snapshot.id,
          offset: (decoded?.offset || 0) + 50,
          period,
          search,
        })
      : null,
  };
}
const cachedDefaultLeaderboard = unstable_cache(
  (period: number, snapshotId: string) =>
    leaderboard(period, "", undefined, snapshotId),
  ["leaderboard"],
  { revalidate: 60, tags: ["public-data"] },
);
export async function cachedLeaderboard(
  period: number,
  search = "",
  cursor?: string,
) {
  // Arbitrary searches/cursors must not create an unbounded filesystem cache.
  if (!process.env.DATABASE_URL || search || cursor)
    return leaderboard(period, search, cursor);
  const [latest] = await sql<{ id: string }>(
    "SELECT id FROM ranking_snapshots WHERE period=$1 ORDER BY created_at DESC LIMIT 1",
    [period],
  );
  // The worker is a separate process, so revalidateTag there cannot expire this
  // cache. The snapshot id is part of the key: the next request misses and
  // shows a snapshot as soon as it exists.
  if (!latest) return leaderboard(period);
  return cachedDefaultLeaderboard(period, latest.id);
}
export async function publicProfile(login: string) {
  if (!process.env.DATABASE_URL) return null;
  const [profile] = await sql<Profile>(
    "SELECT id,github_id,login,name,avatar,bio,tools,x_handle,published_at,hidden_at,last_sync_at,sync_state FROM profiles WHERE lower(login)=lower($1) AND published_at IS NOT NULL AND hidden_at IS NULL",
    [login],
  );
  if (!profile) return null;
  const days = await sql<{
    day: string;
    commits: number;
    prs: number;
    issues: number;
    reviews: number;
    score: number;
  }>(
    "SELECT day::text,commits,prs,issues,reviews,(commits+prs+issues+reviews) AS score FROM daily_stats WHERE profile_id=$1 ORDER BY day",
    [profile.id],
  );
  const ranks = await sql<{
    period: number;
    position: number;
    score: number;
    active_days: number;
  }>(
    `SELECT s.period,e.position,e.score,e.active_days FROM ranking_entries e JOIN ranking_snapshots s ON s.id=e.snapshot_id WHERE e.profile_id=$1 AND s.id IN (SELECT DISTINCT ON(period) id FROM ranking_snapshots ORDER BY period,created_at DESC) AND $2::timestamptz>now()-interval '48 hours'`,
    [profile.id, profile.last_sync_at],
  );
  return { profile, days, ranks };
}
const existingProfileCache = unstable_cache(publicProfile, ["public-profile"], {
  revalidate: 300,
  tags: ["public-data"],
});
export async function cachedPublicProfile(login: string) {
  if (!process.env.DATABASE_URL || !/^[a-z0-9-]{1,39}$/i.test(login))
    return null;
  const [visible] = await sql(
    "SELECT id FROM profiles WHERE lower(login)=lower($1) AND published_at IS NOT NULL AND hidden_at IS NULL",
    [login],
  );
  // Never cache arbitrary missing names; visibility checks also precede cache hits.
  return visible ? existingProfileCache(login.toLowerCase()) : null;
}
export { rebuildRankings } from "./rankings";
export function shareLinks(login: string, period = 7) {
  const url = `${config().APP_URL}/u/${encodeURIComponent(login)}`;
  return {
    profileUrl: url,
    imageUrl: `${config().APP_URL}/api/og/${encodeURIComponent(login)}?period=${period}`,
    text: `See what I've been building. My last ${period} days on ${config().APP_NAME}: ${url}`,
  };
}
