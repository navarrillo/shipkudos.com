import { cardFonts } from "./profile-card";

const C = {
  bg: "#0b0c0d",
  panel: "#111516",
  line: "#353d37",
  muted: "#8b9399",
  lime: "#b9f36a",
  text: "#f1f3ef",
};
const bars = [17, 28, 22, 40, 27, 46, 36, 52, 44, 60, 49, 65];

export { cardFonts };

export function DefaultCard({ appName }: { appName: string }) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        boxSizing: "border-box",
        overflow: "hidden",
        background: C.bg,
        color: C.text,
        fontFamily: "Geist",
        display: "flex",
        flexDirection: "column",
        padding: "56px 64px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -80,
          top: -180,
          width: 560,
          height: 560,
          borderRadius: 280,
          background:
            "radial-gradient(circle, rgba(185,243,106,0.14) 0%, rgba(185,243,106,0) 68%)",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 42,
              height: 42,
              borderRadius: 10,
              background: C.lime,
              color: C.bg,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 600,
            }}
          >
            K
          </div>
          {appName}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "Geist Mono",
            fontSize: 16,
            letterSpacing: 1.5,
            color: C.lime,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: C.lime,
            }}
          />
          PUBLIC SCOREBOARD
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 54, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
          <span
            style={{
              fontSize: 78,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 0.98,
            }}
          >
            Your work.
          </span>
          <div style={{ display: "flex", marginTop: 4, alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 78,
                fontWeight: 600,
                letterSpacing: -3,
                lineHeight: 0.98,
              }}
            >
              Out in the
            </span>
            <span
              style={{
                fontSize: 78,
                fontWeight: 600,
                letterSpacing: -3,
                lineHeight: 0.98,
                color: C.lime,
                marginLeft: 22,
              }}
            >
              open.
            </span>
          </div>
          <span
            style={{
              marginTop: 28,
              fontSize: 26,
              lineHeight: 1.4,
              color: C.muted,
              width: 560,
            }}
          >
            A public activity leaderboard for people building with agents.
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 360,
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 16,
            padding: "26px 28px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "Geist Mono",
              fontSize: 13,
              letterSpacing: 1.2,
              color: C.muted,
            }}
          >
            <span>YOUR NEXT CHAPTER</span>
          </div>
          <span
            style={{
              marginTop: 18,
              fontFamily: "Geist Mono",
              fontSize: 64,
              fontWeight: 500,
              color: C.lime,
              letterSpacing: -2,
            }}
          >
            ship.
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              height: 92,
              marginTop: 18,
            }}
          >
            {bars.map((height, index) => (
              <div
                key={index}
                style={{
                  width: 16,
                  height: height + 18,
                  borderRadius: 3,
                  background: C.lime,
                }}
              />
            ))}
          </div>
          <span
            style={{
              marginTop: 16,
              fontFamily: "Geist Mono",
              fontSize: 13,
              letterSpacing: 1.2,
              color: C.muted,
            }}
          >
            CONNECT. BUILD. REPEAT.
          </span>
        </div>
      </div>
      <span
        style={{
          marginTop: "auto",
          fontFamily: "Geist Mono",
          fontSize: 18,
          letterSpacing: 0.4,
          color: C.muted,
        }}
      >
        Built in public. Measured in progress.
      </span>
    </div>
  );
}
