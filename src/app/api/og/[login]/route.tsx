import { ImageResponse } from "next/og";
import sharp from "sharp";
import { cachedPublicProfile } from "@/lib/data";
import { config } from "@/lib/config";
import { socialImages } from "@/lib/social-image";
import { socialCardResponse } from "@/lib/social";
import { cardFonts, last30Scores, ProfileCard } from "@/lib/profile-card";
import { shareStats } from "@/lib/share";
export const runtime = "nodejs";

async function avatarPng(urlValue: string | null) {
  try {
    const url = new URL(urlValue || "");
    if (url.protocol !== "https:" || url.hostname !== "avatars.githubusercontent.com")
      return null;
    url.searchParams.set("s", "128");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
    if (!response.ok) return null;
    if (Number(response.headers.get("content-length") || 0) > 1048576) return null;
    const input = await response.arrayBuffer();
    if (input.byteLength > 1048576) return null;
    const png = await sharp(input, { limitInputPixels: 1000000 })
      .resize(128, 128)
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ login: string }> },
) {
  const { login } = await params;
  const data = await cachedPublicProfile(login);
  if (!data) return new Response("Not found", { status: 404 });
  const period =
    new URL(request.url).searchParams.get("period") === "30" ? 30 : 7;
  const stats = shareStats(data, period);
  const key = JSON.stringify({
    login: data.profile.login,
    name: data.profile.name,
    avatar: data.profile.avatar,
    tools: data.profile.tools,
    period,
    stats,
    days: data.days.map((day) => [day.day, day.score]),
  });
  return socialCardResponse(
    socialImages.get(key, async () => {
      const avatar = await avatarPng(data.profile.avatar);
      const host = new URL(config().APP_URL).host;
      return new ImageResponse(
        <ProfileCard
          appName={config().APP_NAME}
          host={host}
          login={data.profile.login}
          name={data.profile.name || data.profile.login}
          avatar={avatar}
          tools={data.profile.tools}
          period={period}
          position={stats.ranked ? stats.position : null}
          total={stats.total}
          score={stats.score}
          activeDays={stats.activeDays}
          prs={stats.prs}
          streak={stats.streak}
          scores={last30Scores(data.days)}
        />,
        { width: 1200, height: 630, fonts: cardFonts },
      ).arrayBuffer();
    }),
  );
}
