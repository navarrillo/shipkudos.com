export const SCOPES = ["profile:read", "sync:request", "share:read"] as const;
export type Scope = (typeof SCOPES)[number];
export const TOOLS = [
  "Claude Code",
  "Codex",
  "Cursor",
  "GitHub Copilot",
  "Gemini",
  "Grok",
  "Other",
];
export type Counts = {
  commits: number;
  prs: number;
  issues: number;
  reviews: number;
};
export const activity = (counts: Counts) =>
  counts.commits + counts.prs + counts.issues + counts.reviews;
export function publicCounters(input: Record<string, unknown>): Counts {
  const values = [
    input.totalCommitContributions,
    input.totalPullRequestContributions,
    input.totalIssueContributions,
    input.totalPullRequestReviewContributions,
  ];
  if (
    values.some(
      (value) =>
        typeof value !== "number" || !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error("github_partial_response");
  const [commits, prs, issues, reviews] = values as number[];
  return { commits, prs, issues, reviews };
}
export function stockholmToISO(value: string) {
  const desired = Date.parse(value + "Z");
  let guess = desired;
  const format = (time: number) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date(time))
      .replace(" ", "T");
  for (let i = 0; i < 3; i++)
    guess += desired - Date.parse(format(guess) + "Z");
  if (format(guess).slice(0, 16) !== value)
    throw new Error(
      "That time does not exist in Europe/Stockholm. Choose another time.",
    );
  return new Date(guess).toISOString();
}
export function dayUTC(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
export function daysAgo(days: number, now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days),
  );
}
export function streak(
  days: { day: string; score: number }[],
  now = new Date(),
) {
  const active = new Set(days.filter((d) => d.score > 0).map((d) => d.day));
  let offset = active.has(dayUTC(now)) ? 0 : 1,
    count = 0;
  while (active.has(dayUTC(daysAgo(offset++, now))) && count < 60) count++;
  return { count, capped: count === 60 };
}
export type WorkerStatus = {
  heartbeat_at: Date | string;
  revision: string;
  oldest_runnable_at: Date | string | null;
  progress_at: Date | string | null;
};
export function evaluateReadiness(
  status: WorkerStatus | undefined,
  revision: string,
  now = Date.now(),
  heartbeatSeconds = 120,
  stallSeconds = 600,
) {
  if (!status) return { ok: false, reason: "worker_missing" };
  if (new Date(status.heartbeat_at).getTime() < now - heartbeatSeconds * 1000)
    return { ok: false, reason: "worker_stale" };
  if (status.revision !== revision)
    return { ok: false, reason: "revision_mismatch" };
  const cutoff = now - stallSeconds * 1000;
  if (
    status.oldest_runnable_at &&
    new Date(status.oldest_runnable_at).getTime() < cutoff &&
    (!status.progress_at || new Date(status.progress_at).getTime() < cutoff)
  )
    return { ok: false, reason: "queue_stalled" };
  return { ok: true, reason: "ok" };
}
export const RANKING_PENDING_MESSAGE =
  "Synced — you'll appear on the leaderboard at the next ranking update (within a minute)";
/** Published profile whose latest successful sync is not in a ranking snapshot yet. */
export function awaitingRankingUpdate(
  publishedAt: string | Date | null,
  lastSyncAt: string | Date | null,
  latestSnapshotAt: string | Date | null,
) {
  if (!publishedAt || !lastSyncAt) return false;
  if (!latestSnapshotAt) return true;
  return new Date(lastSyncAt).getTime() > new Date(latestSnapshotAt).getTime();
}
