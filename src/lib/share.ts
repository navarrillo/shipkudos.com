import { config } from "./config";
import { outboundEnabled } from "./runtime";
import { canonicalUrl } from "./seo";
import { dayUTC, daysAgo, streak } from "./domain";

export type ShareDay = {
  day: string;
  commits: number;
  prs: number;
  issues: number;
  reviews: number;
  score: number;
};

export type ShareRank = {
  period: number;
  position: number;
  score: number;
  active_days: number;
  commits?: number;
  prs?: number;
  total?: number;
  snapshot_id?: string;
};

export type ShareInput = {
  profile: {
    login: string;
    name: string;
    tools: string[];
    x_handle?: string | null;
    last_sync_at: Date | string | null;
  };
  days: ShareDay[];
  ranks: ShareRank[];
};

export type ShareStats = {
  ranked: boolean;
  position: number;
  total: number;
  topPct: number | null;
  score: number;
  activeDays: number;
  prs: number;
  commits: number;
  streak: number;
  tools: string;
  period: 7 | 30;
  appName: string;
  version: string;
};

const TWEET_LIMIT = 280;
const URL_LENGTH = 23;

export function explicitPeriod(
  value: string | string[] | undefined,
): 7 | 30 | undefined {
  const period = Array.isArray(value) ? value[0] : value;
  if (period === "30") return 30;
  if (period === "7") return 7;
  return undefined;
}

export function formatTools(tools: string[]) {
  const names = tools.map((tool) => tool.trim()).filter(Boolean).slice(0, 3);
  return names.length ? names.join(" + ") : "AI agents";
}

export function periodWindow(days: ShareDay[], period: number, now = new Date()) {
  const start = dayUTC(daysAgo(period - 1, now));
  const end = dayUTC(now);
  return days.filter((day) => day.day.slice(0, 10) >= start && day.day.slice(0, 10) <= end);
}

export function shareStats(
  data: ShareInput,
  period: 7 | 30,
  now = new Date(),
): ShareStats {
  const rank = data.ranks.find((entry) => entry.period === period);
  const window = periodWindow(data.days, period, now);
  const sum = (pick: (day: ShareDay) => number) =>
    window.reduce((total, day) => total + pick(day), 0);
  const total = rank ? Number(rank.total ?? 0) : 0;
  const position = rank ? Number(rank.position) : 0;
  const sync = data.profile.last_sync_at
    ? new Date(data.profile.last_sync_at).getTime()
    : Number.NaN;
  return {
    ranked: Boolean(rank),
    position,
    total,
    topPct:
      rank && total > 0
        ? Math.max(1, Math.ceil((position / total) * 100))
        : null,
    score: rank ? Number(rank.score) : sum((day) => day.score),
    activeDays: rank
      ? Number(rank.active_days)
      : window.filter((day) => day.score > 0).length,
    prs: rank ? Number(rank.prs ?? sum((day) => day.prs)) : sum((day) => day.prs),
    commits: rank
      ? Number(rank.commits ?? sum((day) => day.commits))
      : sum((day) => day.commits),
    streak: streak(data.days, now).count,
    tools: formatTools(data.profile.tools),
    period,
    appName: config().APP_NAME,
    version: rank?.snapshot_id
      ? String(rank.snapshot_id)
      : Number.isFinite(sync)
        ? String(Math.floor(sync / 1000))
        : "0",
  };
}

function renderShareText(stats: ShareStats) {
  const { appName, period, tools } = stats;
  if (!stats.ranked)
    return `Just claimed my ${appName} profile: my public GitHub activity, verified, built with ${tools}.`;
  if (stats.position <= 10 || (stats.topPct !== null && stats.topPct <= 10))
    return `#${stats.position} on the ${appName} ${period}-day board 🏁\n\n${stats.score} public contributions, ${stats.activeDays}/${period} days shipping with ${tools}.`;
  if (stats.streak >= 5)
    return `${stats.streak}-day shipping streak and counting 🔥\n\n${stats.prs} PRs and ${stats.commits} commits in the last ${period} days, built with ${tools}. Verified from my public GitHub.`;
  return `Shipped on ${stats.activeDays} of the last ${period} days with ${tools}.\n${stats.score} contributions, #${stats.position} among builders on ${appName}.\n\nThink you ship more?`;
}

export function tweetLength(text: string) {
  return text.length + URL_LENGTH;
}

export function shareText(stats: ShareStats) {
  const parts = stats.tools.split(" + ");
  const labels = [stats.tools];
  if (parts.length >= 3) labels.push(parts.slice(0, 2).join(" + "));
  if (parts.length >= 2) labels.push(parts[0]);
  if (stats.tools !== "AI agents") labels.push("AI agents");
  for (const tools of [...new Set(labels)]) {
    const text = renderShareText({ ...stats, tools });
    if (tweetLength(text) <= TWEET_LIMIT) return text;
  }
  const text = renderShareText({ ...stats, tools: "AI agents" });
  const room = TWEET_LIMIT - URL_LENGTH;
  if (text.length <= room) return text;
  return `${text.slice(0, room - 1).trimEnd()}…`;
}

function quality(stats: ShareStats) {
  if (!stats.ranked) return Number.POSITIVE_INFINITY;
  return stats.total > 0 ? stats.position / stats.total : stats.position;
}

/** Prefer the period where the builder ranks higher. Unranked periods lose. */
export function preferredPeriod(data: ShareInput, now = new Date()): 7 | 30 {
  const week = quality(shareStats(data, 7, now));
  const month = quality(shareStats(data, 30, now));
  if (week !== month) return week < month ? 7 : 30;
  return 7;
}

export function profileCardUrl(login: string, period: number, version: string) {
  const image = canonicalUrl(
    `/api/og/${encodeURIComponent(login.toLowerCase())}`,
  );
  return `${image}?period=${period}&v=${encodeURIComponent(version)}`;
}

export function shareLinks(data: ShareInput, period?: 7 | 30, now = new Date()) {
  const chosen = period ?? preferredPeriod(data, now);
  const stats = shareStats(data, chosen, now);
  const text = shareText(stats);
  const profileUrl = canonicalUrl(
    `/u/${encodeURIComponent(data.profile.login.toLowerCase())}`,
  );
  const imageUrl = profileCardUrl(data.profile.login, chosen, stats.version);
  const intentUrl = outboundEnabled()
    ? `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(profileUrl)}`
    : profileUrl;
  return { profileUrl, imageUrl, text, intentUrl, period: chosen };
}
