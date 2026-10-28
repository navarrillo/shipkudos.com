import { createHash } from "node:crypto";
import { ImageResponse } from "next/og.js";
import { config } from "./config";
import { cachedAvatarPng } from "./avatar-image";
import { cardFonts, last30Scores, ProfileCard } from "./profile-card";
import { shareStats } from "./share";
import type { publicProfile } from "./profile-data";

export type CardData = NonNullable<Awaited<ReturnType<typeof publicProfile>>>;

/** These are exactly the props used by the original on-demand renderer. */
export function profileCardProps(
  data: CardData,
  period: 7 | 30,
  now = new Date(),
) {
  const stats = shareStats(data, period, now);
  return {
    appName: config().APP_NAME,
    host: new URL(config().APP_URL).host,
    login: data.profile.login,
    name: data.profile.name || data.profile.login,
    tools: data.profile.tools,
    period,
    position: stats.ranked ? stats.position : null,
    total: stats.total,
    score: stats.score,
    activeDays: stats.activeDays,
    prs: stats.prs,
    streak: stats.streak,
    scores: last30Scores(data.days, now),
  };
}

export function profileCardVersion(
  data: CardData,
  period: 7 | 30,
  now = new Date(),
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        props: profileCardProps(data, period, now),
        avatar: data.profile.avatar,
        // Include sync/snapshot changes even if the displayed totals remain equal.
        source: shareStats(data, period, now).version,
        sync: data.profile.last_sync_at,
      }),
    )
    .digest("hex")
    .slice(0, 32);
}

export async function renderProfileCard(
  data: CardData,
  period: 7 | 30,
  now = new Date(),
) {
  const started = performance.now();
  try {
    const avatar = await cachedAvatarPng(data.profile.avatar);
    return await new ImageResponse(
      <ProfileCard {...profileCardProps(data, period, now)} avatar={avatar} />,
      { width: 1200, height: 630, fonts: cardFonts },
    ).arrayBuffer();
  } finally {
    console.log(
      JSON.stringify({
        event: "share_card_render",
        login: data.profile.login,
        period,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
}
