import { afterEach, describe, expect, it } from "vitest";
import { dayUTC, daysAgo } from "../../src/lib/domain";
import {
  formatTools,
  preferredPeriod,
  shareLinks,
  shareStats,
  shareText,
  tweetLength,
  type ShareInput,
  type ShareStats,
} from "../../src/lib/share";

const previous = { APP_URL: process.env.APP_URL, APP_NAME: process.env.APP_NAME };
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stats(patch: Partial<ShareStats> = {}): ShareStats {
  return {
    ranked: true,
    position: 1,
    total: 100,
    topPct: 1,
    score: 109,
    activeDays: 7,
    prs: 12,
    commits: 40,
    streak: 7,
    tools: "Codex + Cursor + Grok",
    period: 7,
    appName: "ShipKudos",
    version: "snap",
    ...patch,
  };
}
function days(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    day: dayUTC(daysAgo(index)),
    commits: 2,
    prs: 1,
    issues: 0,
    reviews: 0,
    score: 3,
  }));
}
function profile(patch: Partial<ShareInput> = {}): ShareInput {
  return {
    profile: {
      login: "Ada",
      name: "Ada Lovelace",
      tools: ["Codex", "Cursor", "Grok", "Claude Code"],
      last_sync_at: new Date("2026-10-27T12:00:00Z"),
    },
    days: days(7),
    ranks: [],
    ...patch,
  };
}

describe("share text", () => {
  it("formats at most three tools and falls back when none are declared", () => {
    expect(formatTools([" Codex ", "Cursor", "Grok", "Extra"])).toBe(
      "Codex + Cursor + Grok",
    );
    expect(formatTools([])).toBe("AI agents");
    expect(formatTools(["", "  "])).toBe("AI agents");
  });
  it("uses the rank template for a top-10 or top-10% position", () => {
    expect(shareText(stats())).toBe(
      "#1 on the ShipKudos 7-day board 🏁\n\n109 public contributions, 7/7 days shipping with Codex + Cursor + Grok.",
    );
    expect(
      shareText(stats({ position: 12, total: 200, topPct: 6, streak: 0 })),
    ).toContain("#12 on the ShipKudos 7-day board");
  });
  it("uses the streak template when the builder is outside the top tier", () => {
    expect(
      shareText(
        stats({
          position: 40,
          total: 100,
          topPct: 40,
          streak: 5,
          tools: "Claude Code",
        }),
      ),
    ).toBe(
      "5-day shipping streak and counting 🔥\n\n12 PRs and 40 commits in the last 7 days, built with Claude Code. Verified from my public GitHub.",
    );
  });
  it("uses the challenge template otherwise", () => {
    expect(
      shareText(
        stats({
          position: 40,
          total: 100,
          topPct: 40,
          streak: 2,
          activeDays: 4,
          score: 20,
          period: 30,
          tools: "Cursor",
        }),
      ),
    ).toBe(
      "Shipped on 4 of the last 30 days with Cursor.\n20 contributions, #40 among builders on ShipKudos.\n\nThink you ship more?",
    );
  });
  it("uses the unranked template when there is no board position", () => {
    expect(
      shareText(stats({ ranked: false, tools: "Grok", position: 0, topPct: null })),
    ).toBe(
      "Just claimed my ShipKudos profile: my public GitHub activity, verified, built with Grok.",
    );
  });
  it("keeps every template inside 280 characters with the URL counted as 23", () => {
    const samples = [
      stats(),
      stats({ position: 40, topPct: 40, streak: 9, tools: "A".repeat(80) + " + " + "B".repeat(80) }),
      stats({ ranked: false, tools: "X".repeat(240) }),
      stats({ position: 80, topPct: 80, streak: 1, period: 30, tools: "AI agents" }),
    ];
    for (const sample of samples) {
      const text = shareText(sample);
      expect(tweetLength(text)).toBeLessThanOrEqual(280);
      expect(text).not.toContain("http");
    }
  });
});

describe("share links", () => {
  it("posts through x.com and cache-busts the image with the snapshot", () => {
    process.env.APP_URL = "https://cards.example";
    process.env.APP_NAME = "PreviewName";
    const links = shareLinks(
      profile({
        ranks: [
          {
            period: 7,
            position: 1,
            score: 109,
            active_days: 7,
            commits: 70,
            prs: 35,
            total: 80,
            snapshot_id: "snap-9",
          },
        ],
      }),
      7,
    );
    const intent = new URL(links.intentUrl);
    expect(`${intent.origin}${intent.pathname}`).toBe("https://x.com/intent/post");
    expect(intent.searchParams.get("text")).toBe(links.text);
    expect(intent.searchParams.get("url")).toBe("https://cards.example/u/ada");
    expect(links.profileUrl).toBe("https://cards.example/u/ada");
    expect(links.imageUrl).toBe(
      "https://cards.example/api/og/ada?period=7&v=snap-9",
    );
    expect(links.text).toContain("#1 on the PreviewName 7-day board");
    expect(links.text).not.toContain("https://");
  });
  it("versions an unranked card from the last sync", () => {
    process.env.APP_URL = "https://cards.example";
    const links = shareLinks(profile(), 7);
    expect(links.imageUrl).toContain("v=1793102400");
    expect(links.text).toContain("Just claimed my");
    expect(shareStats(profile(), 7).ranked).toBe(false);
  });
  it("picks the period with the stronger rank when none is requested", () => {
    const data = profile({
      ranks: [
        {
          period: 7,
          position: 40,
          score: 10,
          active_days: 2,
          total: 100,
          snapshot_id: "week",
        },
        {
          period: 30,
          position: 4,
          score: 80,
          active_days: 12,
          total: 100,
          snapshot_id: "month",
        },
      ],
    });
    expect(preferredPeriod(data)).toBe(30);
    expect(shareLinks(data).period).toBe(30);
    expect(shareLinks(data).imageUrl).toContain("period=30&v=month");
  });
});
