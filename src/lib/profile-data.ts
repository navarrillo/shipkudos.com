import { sql } from "../db";
import type { Profile } from "./data";

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
    commits: number;
    prs: number;
    total: number;
    snapshot_id: string;
  }>(
    `SELECT s.period,s.id AS snapshot_id,e.position,e.score,e.active_days,e.commits,e.prs,(SELECT count(*)::int FROM ranking_entries WHERE snapshot_id=s.id) AS total FROM ranking_entries e JOIN ranking_snapshots s ON s.id=e.snapshot_id WHERE e.profile_id=$1 AND s.id IN (SELECT DISTINCT ON(period) id FROM ranking_snapshots ORDER BY period,created_at DESC) AND $2::timestamptz>now()-interval '48 hours'`,
    [profile.id, profile.last_sync_at],
  );
  return { profile, days, ranks };
}
