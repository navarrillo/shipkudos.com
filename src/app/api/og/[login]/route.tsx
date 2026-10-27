/* eslint-disable @next/next/no-img-element -- ImageResponse uses Satori, not a browser image component. */
import { ImageResponse } from "next/og";
import { cachedPublicProfile } from "@/lib/data";
import { config } from "@/lib/config";
import { socialImages } from "@/lib/social-image";
import sharp from "sharp";
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
  const rank = data.ranks.find((r) => r.period === period);
  const key = JSON.stringify([
    data.profile.login,
    data.profile.name,
    data.profile.avatar,
    data.profile.last_sync_at,
    period,
    rank,
  ]);
  const bytes = await socialImages.get(key, async () => {
    let avatar: string | null = null;
    try {
      const url = new URL(data.profile.avatar || "");
      if (
        url.protocol === "https:" &&
        url.hostname === "avatars.githubusercontent.com"
      ) {
        url.searchParams.set("s", "128");
        const response = await fetch(url, {
          signal: AbortSignal.timeout(2000),
          redirect: "error",
        });
        if (
          response.ok &&
          Number(response.headers.get("content-length") || 0) <= 1048576
        ) {
          const input = await response.arrayBuffer();
          if (input.byteLength <= 1048576)
            avatar =
              "data:image/webp;base64," +
              (
                await sharp(input, { limitInputPixels: 1000000 })
                  .resize(128, 128)
                  .webp()
                  .toBuffer()
              ).toString("base64");
        }
      }
    } catch {
      /* The identity and score remain shareable if the avatar is unavailable. */
    }
    return new ImageResponse(
      <div
        style={{
          background: "#0b0e0c",
          color: "#eef4e9",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 27,
          }}
        >
          <span>{config().APP_NAME}</span>
          <span style={{ color: "#b9f36a" }}>
            PUBLIC ACTIVITY · {period} DAYS
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginTop: 50,
          }}
        >
          {avatar ? (
            <img
              src={avatar}
              width={88}
              height={88}
              alt=""
              style={{ borderRadius: 44 }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 88,
                height: 88,
                borderRadius: 44,
                background: "#24301d",
                color: "#b9f36a",
                fontSize: 42,
              }}
            >
              {data.profile.login[0].toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 40 }}>@{data.profile.login}</span>
            <span style={{ fontSize: 22, color: "#91a087" }}>
              {String(data.profile.name || data.profile.login).slice(0, 40)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 90, marginTop: 40 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 90, color: "#b9f36a" }}>
              {rank?.score?.toLocaleString("en") ?? "Pending"}
            </span>
            <span>PUBLIC CONTRIBUTIONS</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 90 }}>
              {rank ? `#${rank.position}` : "—"}
            </span>
            <span>AMONG PARTICIPATING BUILDERS</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            color: "#91a087",
            fontSize: 19,
          }}
        >
          GitHub identity verified · As of{" "}
          {data.profile.last_sync_at
            ? new Date(data.profile.last_sync_at)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ") + " UTC"
            : "initial sync"}
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": "public,max-age=300" },
      },
    ).arrayBuffer();
  });
  if (!bytes)
    return new Response("Card renderer is busy. Retry shortly.", {
      status: 503,
      headers: { "Retry-After": "5", "Cache-Control": "no-store" },
    });
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public,max-age=300",
    },
  });
}
