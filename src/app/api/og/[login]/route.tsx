import { ImageResponse } from "next/og";
import { cachedPublicProfile } from "@/lib/data";
import { config } from "@/lib/config";
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
      <div style={{ display: "flex", fontSize: 64, marginTop: 70 }}>
        @{data.profile.login}
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
  );
}
