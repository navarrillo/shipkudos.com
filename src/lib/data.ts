import { unstable_cache } from "next/cache";
import { publicProfile } from "./profile-data";
export { publicProfile } from "./profile-data";
import { sql } from "../db";
import { HttpError } from "./http";
import { signPayload, verifyPayload } from "./crypto";
import { shareLinks as buildShareLinks } from "./share";

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
export const PUBLIC_PROFILE_FIELDS = [
  "login",
  "name",
  "avatar",
  "bio",
  "tools",
  "x_handle",
  "published_at",
  "last_sync_at",
] as const;
export const PUBLIC_LEADERBOARD_FIELDS = [
  "login",
  "name",
  "avatar",
  "tools",
  "last_sync_at",
  "position",
  "score",
  "commits",
  "prs",
  "issues",
  "reviews",
  "active_days",
] as const;
export type PublicProfileIdentity = Pick<
  Profile,
  (typeof PUBLIC_PROFILE_FIELDS)[number]
>;
export type PublicLeaderboardEntry = Pick<
  RankedProfile,
  (typeof PUBLIC_LEADERBOARD_FIELDS)[number]
>;
export function toPublicProfileView(data: {
  profile: Profile;
  days: {
    day: string;
    commits: number;
    prs: number;
    issues: number;
    reviews: number;
    score: number;
  }[];
  ranks: {
    period: number;
    position: number;
    score: number;
    active_days: number;
    commits?: number;
    prs?: number;
    total?: number;
    snapshot_id?: string;
  }[];
}) {
  const profile: PublicProfileIdentity = {
    login: data.profile.login,
    name: data.profile.name,
    avatar: data.profile.avatar,
    bio: data.profile.bio,
    tools: data.profile.tools,
    x_handle: data.profile.x_handle,
    published_at: data.profile.published_at,
    last_sync_at: data.profile.last_sync_at,
  };
  return {
    profile,
    days: data.days.map((day) => ({
      day: day.day,
      commits: day.commits,
      prs: day.prs,
      issues: day.issues,
      reviews: day.reviews,
      score: day.score,
    })),
    ranks: data.ranks.map((rank) => ({
      period: rank.period,
      position: rank.position,
      score: rank.score,
      active_days: rank.active_days,
    })),
  };
}
export function toPublicLeaderboard(result: {
  entries: RankedProfile[];
  snapshot: { id: string; created_at: Date } | null;
  nextCursor: string | null;
}) {
  return {
    entries: result.entries.map(
      (entry): PublicLeaderboardEntry => ({
        login: entry.login,
        name: entry.name,
        avatar: entry.avatar,
        tools: entry.tools,
        last_sync_at: entry.last_sync_at,
        position: entry.position,
        score: entry.score,
        commits: entry.commits,
        prs: entry.prs,
        issues: entry.issues,
        reviews: entry.reviews,
        active_days: entry.active_days,
      }),
    ),
    snapshot: result.snapshot
      ? { id: result.snapshot.id, created_at: result.snapshot.created_at }
      : null,
    nextCursor: result.nextCursor,
  };
}
export function shareLinks(
  data: Parameters<typeof buildShareLinks>[0],
  period?: 7 | 30,
) {
  return buildShareLinks(data, period);
}
/** Stable sample for the agent guide and OpenAPI, matching GET /api/v1/me/share. */
export const exampleShareInput = {
  profile: {
    login: "octocat",
    name: "The Octocat",
    tools: [] as string[],
    last_sync_at: "2026-10-27T21:22:00.000Z",
  },
  days: [],
  ranks: [],
} satisfies Parameters<typeof buildShareLinks>[0];
