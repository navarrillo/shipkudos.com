import { ImageResponse } from "next/og";
import { cachedPublicProfile } from "@/lib/data";
import { config } from "@/lib/config";
import { socialImages } from "@/lib/social-image";
import { socialCardResponse } from "@/lib/social";
import { cardFonts, last30Scores, ProfileCard } from "@/lib/profile-card";
import { shareStats } from "@/lib/share";
import { fetchAvatarPng } from "@/lib/avatar-image";
export const runtime = "nodejs";

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
      const avatar = await fetchAvatarPng(data.profile.avatar);
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
