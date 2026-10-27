/* eslint-disable @next/next/no-img-element -- Satori renders this tree; it is not a browser image. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dayUTC, daysAgo } from "./domain";

const fontFile = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)));

export const cardFonts = [
  { name: "Geist", data: fontFile("../assets/fonts/Geist-Regular.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Geist", data: fontFile("../assets/fonts/Geist-Medium.ttf"), weight: 500 as const, style: "normal" as const },
  { name: "Geist", data: fontFile("../assets/fonts/Geist-SemiBold.ttf"), weight: 600 as const, style: "normal" as const },
  { name: "Geist Mono", data: fontFile("../assets/fonts/GeistMono-Regular.ttf"), weight: 400 as const, style: "normal" as const },
  { name: "Geist Mono", data: fontFile("../assets/fonts/GeistMono-Medium.ttf"), weight: 500 as const, style: "normal" as const },
];

const C = {
  bg: "#0b0c0d",
  panel: "#101214",
  line: "#24272a",
  muted: "#8b9399",
  lime: "#b9f36a",
  text: "#f1f3ef",
  dim: "#1a1d1f",
};
const mono = {
  fontFamily: "Geist Mono",
  letterSpacing: 1.5,
  textTransform: "uppercase" as const,
};

export function last30Scores(
  days: { day: string; score: number }[],
  now = new Date(),
) {
  const byDay = new Map(days.map((day) => [day.day.slice(0, 10), day.score]));
  const scores: number[] = [];
  for (let offset = 29; offset >= 0; offset--)
    scores.push(byDay.get(dayUTC(daysAgo(offset, now))) ?? 0);
  return scores;
}

function stat(value: string, label: string, accent = false) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        paddingRight: 36,
        marginRight: 36,
        borderRight: `1px solid ${C.line}`,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize: 56,
          fontWeight: 600,
          letterSpacing: -2,
          color: accent ? C.lime : C.text,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span style={{ ...mono, fontSize: 15, color: C.muted }}>{label}</span>
    </div>
  );
}

function heat(scores: number[], period: number) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
      {scores.map((score, index) => {
        const inPeriod = index >= scores.length - period;
        const alpha = score ? Math.min(1, 0.25 + score / 30) : 0;
        return (
          <div
            key={index}
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              background: score
                ? `rgba(185,243,106,${inPeriod ? alpha : alpha * 0.45})`
                : C.dim,
            }}
          />
        );
      })}
    </div>
  );
}

export function ProfileCard({
  appName,
  host,
  login,
  name,
  avatar,
  tools,
  period,
  position,
  total,
  score,
  activeDays,
  prs,
  streak: streakDays,
  scores,
}: {
  appName: string;
  host: string;
  login: string;
  name: string;
  avatar: string | null;
  tools: string[];
  period: 7 | 30;
  position: number | null;
  total: number;
  score: number;
  activeDays: number;
  prs: number;
  streak: number;
  scores: number[];
}) {
  const big = position ? `#${position}` : "New";
  const rankSize = big.length >= 4 ? 100 : big.length === 3 ? 124 : 150;
  const sub = position
    ? total >= 20
      ? `TOP ${Math.max(1, Math.ceil((position / total) * 100))}% · ${period}-DAY BOARD`
      : `${period}-DAY BOARD`
    : "JUST JOINED · NOT RANKED YET";
  const visible = name.length > 48 ? `${name.slice(0, 47)}…` : name;
  const nameSize = visible.length > 24 ? 36 : visible.length > 16 ? 44 : 54;
  const chips = tools.map((tool) => tool.trim()).filter(Boolean).slice(0, 3);
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
        padding: "52px 64px",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -160,
          top: -220,
          width: 620,
          height: 620,
          borderRadius: 310,
          background:
            "radial-gradient(circle, rgba(185,243,106,0.16) 0%, rgba(185,243,106,0) 70%)",
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
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 38,
              height: 38,
              borderRadius: 10,
              background: C.lime,
              color: C.bg,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            K
          </div>
          {appName}
        </div>
        <div
          style={{
            ...mono,
            display: "flex",
            fontSize: 16,
            color: C.lime,
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: "8px 16px",
            gap: 10,
            alignItems: "center",
            boxSizing: "border-box",
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
          GITHUB VERIFIED
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 44,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {avatar ? (
            <img
              src={avatar}
              width={120}
              height={120}
              alt=""
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                border: `3px solid ${C.lime}`,
                boxSizing: "border-box",
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 120,
                height: 120,
                borderRadius: 60,
                background: "#24301d",
                color: C.lime,
                fontSize: 56,
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
              }}
            >
              {(login[0] || "?").toUpperCase()}
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              width: 500,
            }}
          >
            <span
              style={{
                fontSize: nameSize,
                fontWeight: 600,
                letterSpacing: -2,
                lineHeight: 1.05,
              }}
            >
              {visible}
            </span>
            <span style={{ fontFamily: "Geist Mono", fontSize: 24, color: C.muted }}>
              @{login}
            </span>
            {chips.length ? (
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <span
                  style={{
                    ...mono,
                    fontSize: 15,
                    color: C.muted,
                    alignSelf: "center",
                  }}
                >
                  SHIPS WITH
                </span>
                {chips.map((tool) => (
                  <span
                    key={tool}
                    style={{
                      fontSize: 18,
                      fontWeight: 500,
                      color: C.text,
                      background: C.panel,
                      border: `1px solid ${C.line}`,
                      borderRadius: 8,
                      padding: "5px 12px",
                      boxSizing: "border-box",
                    }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: rankSize,
              fontWeight: 600,
              letterSpacing: -8,
              color: C.lime,
              lineHeight: 0.9,
            }}
          >
            {big}
          </span>
          <span style={{ ...mono, fontSize: 16, color: C.muted, marginTop: 10 }}>
            {sub}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 46 }}>
        {stat(String(score), `CONTRIBUTIONS · ${period}D`, true)}
        {stat(`${activeDays}/${period}`, "ACTIVE DAYS")}
        {stat(String(prs), `PULL REQUESTS · ${period}D`)}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontSize: 56,
              fontWeight: 600,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {streakDays}d
          </span>
          <span style={{ ...mono, fontSize: 15, color: C.muted }}>
            CURRENT STREAK
          </span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ ...mono, fontSize: 13, color: C.muted }}>LAST 30 DAYS</span>
          {heat(scores, period)}
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 20, color: C.text }}>
          {host}/u/{login}
        </span>
      </div>
    </div>
  );
}
