import type { Metadata } from "next";
import { config } from "./config";
import { isStaging } from "./runtime";

export function canonicalUrl(path: string): string {
  const root = new URL(config().APP_URL).href.replace(/\/$/, "");
  const relative = path.startsWith("/") ? path : `/${path}`;
  return relative === "/" ? root : `${root}${relative}`;
}

export function rootMetadata(): Metadata {
  const app = config().APP_NAME;
  return {
    metadataBase: new URL(config().APP_URL),
    title: {
      default: `${app} — Leaderboard for developers shipping with AI coding agents`,
      template: `%s · ${app}`,
    },
    ...(isStaging() ? { robots: { index: false, follow: false } } : {}),
  };
}

export function homeMetadata(): Metadata {
  const app = config().APP_NAME;
  return {
    description: `${app} is the public leaderboard for developers shipping with AI coding agents. Connect GitHub, show your commits, pull requests, issues, and reviews, and earn a place among builders.`,
    alternates: { canonical: canonicalUrl("/") },
  };
}

export function agentsMetadata(): Metadata {
  const app = config().APP_NAME;
  return {
    title: "For agents",
    description: `Let a coding agent register your GitHub profile on ${app}, check your rank, and request a sync. Agent keys are scoped and revocable.`,
    alternates: {
      canonical: canonicalUrl("/agents"),
      types: { "text/markdown": "/agents.md" },
    },
  };
}

export function advertiseMetadata(): Metadata {
  const app = config().APP_NAME;
  return {
    title: "Advertise",
    description: `Advertise AI developer tools to people shipping in public on the ${app} leaderboard. Sponsorships are labelled and never change a builder's rank.`,
    alternates: { canonical: canonicalUrl("/advertise") },
  };
}

const infoPages: Record<string, { title: string; description: (app: string) => string }> =
  {
    methodology: {
      title: "How the ranking works",
      description: (app) =>
        `How the ${app} ranking works: public GitHub commits, pull requests, issues, and reviews over the last 7 and 30 days. Equal scores share a rank, and sponsors cannot buy positions.`,
    },
    privacy: {
      title: "Privacy policy",
      description: (app) =>
        `Privacy policy for ${app}: what we store after GitHub authorization, how published profiles and agent credentials work, and how to unpublish or delete your account.`,
    },
    terms: {
      title: "Terms of use",
      description: (app) =>
        `Terms for participating on ${app}: use a personal GitHub account, rankings reflect public activity only, and labelled sponsorships never change a builder's position.`,
    },
  };

export function infoMetadata(info: string): Metadata | undefined {
  const page = infoPages[info];
  if (!page) return undefined;
  return {
    title: page.title,
    description: page.description(config().APP_NAME),
    alternates: { canonical: canonicalUrl(`/${info}`) },
  };
}

export function leaderboardMetadata(params: {
  period?: string;
  q?: string;
  cursor?: string;
}): Metadata {
  const days = params.period === "30" ? 30 : 7;
  const app = config().APP_NAME;
  const metadata: Metadata = {
    title: `Top builders shipping with AI agents (${days} days)`,
    description: `Top builders shipping with AI agents over the last ${days} days, ranked by public GitHub contributions on ${app}.`,
    alternates: {
      canonical: canonicalUrl(
        days === 30 ? "/leaderboard?period=30" : "/leaderboard",
      ),
    },
  };
  if (params.q !== undefined || params.cursor !== undefined)
    metadata.robots = isStaging()
      ? { index: false, follow: false }
      : { index: false };
  return metadata;
}

type PublicIdentity = { name: string; login: string; tools: string[] };

function toolList(tools: string[]) {
  return tools.filter(Boolean).join(", ");
}

export function profileTitle(profile: PublicIdentity) {
  const tools = profile.tools.filter(Boolean).slice(0, 3).join(" + ");
  return `${profile.name} (@${profile.login}) — ships with ${tools || "AI agents"}`;
}

export function profileDescription(
  profile: PublicIdentity,
  weekly: { score: number; position: number } | undefined,
  appName = config().APP_NAME,
) {
  const tools = toolList(profile.tools);
  const ships = tools ? ` Ships with ${tools}.` : "";
  const who = `${profile.name} (@${profile.login})`;
  if (weekly)
    return `${who}: ${weekly.score.toLocaleString("en")} public GitHub contributions in 7 days, #${weekly.position} on ${appName}.${ships}`;
  return `${who}: public GitHub activity on ${appName}.${ships || " Ships with AI agents."}`;
}

export function profileCanonical(login: string) {
  return canonicalUrl(`/u/${encodeURIComponent(login.toLowerCase())}`);
}

export function publicProfileMetadata(
  profile: PublicIdentity,
  ranks: { period: number; position: number; score: number }[],
): Metadata {
  const weekly = ranks.find((rank) => rank.period === 7);
  return {
    title: profileTitle(profile),
    description: profileDescription(profile, weekly),
    alternates: { canonical: profileCanonical(profile.login) },
  };
}

export function searchString(
  params: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value))
      for (const item of value) query.append(key, item);
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

export function profileRedirectTarget(login: string, search = ""): string | null {
  if (login === login.toLowerCase()) return null;
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `/u/${encodeURIComponent(login.toLowerCase())}${query}`;
}

export function profilePathRedirect(pathname: string, search = ""): string | null {
  const match = /^\/u\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let login = match[1];
  try {
    login = decodeURIComponent(login);
  } catch {
    return null;
  }
  return profileRedirectTarget(login, search);
}
