import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import {
  advertiseMetadata,
  agentsMetadata,
  canonicalUrl,
  homeMetadata,
  infoMetadata,
  leaderboardMetadata,
  profileCanonical,
  profileDescription,
  profilePathRedirect,
  profileTitle,
  rootMetadata,
} from "../../src/lib/seo";
import { generateMetadata as homePageMetadata } from "../../src/app/page";
import { generateMetadata as agentsPageMetadata } from "../../src/app/agents/page";
import { generateMetadata as advertisePageMetadata } from "../../src/app/advertise/page";
import { generateMetadata as infoPageMetadata } from "../../src/app/[info]/page";
import { generateMetadata as leaderboardPageMetadata } from "../../src/app/leaderboard/page";
import { generateMetadata as profilePageMetadata } from "../../src/app/u/[login]/page";

const previousUrl = process.env.APP_URL;
const previousName = process.env.APP_NAME;
process.env.APP_URL = "https://shipkudos.com";
process.env.APP_NAME = "ShipKudos";

afterAll(() => {
  if (previousUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousUrl;
  if (previousName === undefined) delete process.env.APP_NAME;
  else process.env.APP_NAME = previousName;
});

describe("canonical URLs", () => {
  it("builds every public URL from the configured base", () => {
    expect(canonicalUrl("/")).toBe("https://shipkudos.com");
    expect(canonicalUrl("/leaderboard")).toBe("https://shipkudos.com/leaderboard");
    expect(canonicalUrl("/leaderboard?period=30")).toBe(
      "https://shipkudos.com/leaderboard?period=30",
    );
    expect(canonicalUrl("/agents")).toBe("https://shipkudos.com/agents");
    expect(canonicalUrl("/advertise")).toBe("https://shipkudos.com/advertise");
    expect(canonicalUrl("/methodology")).toBe(
      "https://shipkudos.com/methodology",
    );
    expect(canonicalUrl("/privacy")).toBe("https://shipkudos.com/privacy");
    expect(canonicalUrl("/terms")).toBe("https://shipkudos.com/terms");
    expect(profileCanonical("Navarrillo")).toBe(
      "https://shipkudos.com/u/navarrillo",
    );
  });

  it("strips a trailing slash from the configured base", () => {
    process.env.APP_URL = "https://shipkudos.com/";
    expect(canonicalUrl("/leaderboard")).toBe(
      "https://shipkudos.com/leaderboard",
    );
    process.env.APP_URL = "https://shipkudos.com";
  });

  it("points each public page at its own canonical URL", async () => {
    expect(homePageMetadata()).toEqual(homeMetadata());
    expect(agentsPageMetadata()).toEqual(agentsMetadata());
    expect(advertisePageMetadata()).toEqual(advertiseMetadata());
    expect(
      await infoPageMetadata({ params: Promise.resolve({ info: "methodology" }) }),
    ).toEqual(infoMetadata("methodology"));
    expect(
      await infoPageMetadata({ params: Promise.resolve({ info: "privacy" }) }),
    ).toEqual(infoMetadata("privacy"));
    expect(
      await infoPageMetadata({ params: Promise.resolve({ info: "terms" }) }),
    ).toEqual(infoMetadata("terms"));
    expect(homeMetadata().alternates?.canonical).toBe("https://shipkudos.com");
    expect(agentsMetadata().alternates?.canonical).toBe(
      "https://shipkudos.com/agents",
    );
    expect(advertiseMetadata().alternates?.canonical).toBe(
      "https://shipkudos.com/advertise",
    );
    expect(infoMetadata("methodology")?.alternates?.canonical).toBe(
      "https://shipkudos.com/methodology",
    );
    expect(infoMetadata("privacy")?.alternates?.canonical).toBe(
      "https://shipkudos.com/privacy",
    );
    expect(infoMetadata("terms")?.alternates?.canonical).toBe(
      "https://shipkudos.com/terms",
    );
    expect(leaderboardMetadata({}).alternates?.canonical).toBe(
      "https://shipkudos.com/leaderboard",
    );
    expect(leaderboardMetadata({ period: "7" }).alternates?.canonical).toBe(
      "https://shipkudos.com/leaderboard",
    );
    expect(leaderboardMetadata({ period: "30" }).alternates?.canonical).toBe(
      "https://shipkudos.com/leaderboard?period=30",
    );
  });
});

describe("profile login redirect", () => {
  it("308-redirects uppercase logins and preserves the query string", () => {
    const response = proxy(
      new NextRequest(
        "https://shipkudos.com/u/NAVARRILLO?period=30&ref=share",
      ),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://shipkudos.com/u/navarrillo?period=30&ref=share",
    );
  });

  it("redirects mixed-case logins and drops a trailing slash", () => {
    expect(profilePathRedirect("/u/Navarrillo/", "?x=1")).toBe(
      "/u/navarrillo?x=1",
    );
    const response = proxy(
      new NextRequest("https://shipkudos.com/u/Foo-Bar?q=a%20b"),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://shipkudos.com/u/foo-bar?q=a%20b",
    );
  });

  it("builds Location from the configured base, not the proxy request URL", () => {
    const response = proxy(
      new NextRequest("http://127.0.0.1:3000/u/NAVARRILLO?period=7"),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://shipkudos.com/u/navarrillo?period=7",
    );
  });

  it("leaves an already lowercase profile URL alone", () => {
    const response = proxy(
      new NextRequest("https://shipkudos.com/u/navarrillo?period=7"),
    );
    expect(response.status).not.toBe(308);
    expect(response.headers.get("location")).toBeNull();
    expect(profilePathRedirect("/u/navarrillo", "?period=7")).toBeNull();
  });

  it("redirects before the profile page renders metadata", async () => {
    await expect(
      profilePageMetadata({
        params: Promise.resolve({ login: "NAVARRILLO" }),
        searchParams: Promise.resolve({ period: "7", ref: "board" }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("/u/navarrillo?period=7&ref=board;308;"),
    });
  });
});

describe("leaderboard indexing", () => {
  it("noindexes search and cursor variants and canonicalizes the clean board", async () => {
    const search = await leaderboardPageMetadata({
      searchParams: Promise.resolve({ q: "ada", period: "7" }),
    });
    expect(search.robots).toEqual({ index: false });
    expect(search.alternates?.canonical).toBe(
      "https://shipkudos.com/leaderboard",
    );
    const page = await leaderboardPageMetadata({
      searchParams: Promise.resolve({ cursor: "next", period: "30" }),
    });
    expect(page.robots).toEqual({ index: false });
    expect(page.alternates?.canonical).toBe(
      "https://shipkudos.com/leaderboard?period=30",
    );
    expect(
      leaderboardMetadata({ q: "", cursor: "" }).robots,
    ).toEqual({ index: false });
  });

  it("keeps the clean 7-day and 30-day boards indexable", async () => {
    const week = await leaderboardPageMetadata({
      searchParams: Promise.resolve({}),
    });
    const month = await leaderboardPageMetadata({
      searchParams: Promise.resolve({ period: "30" }),
    });
    expect(week.robots).toBeUndefined();
    expect(month.robots).toBeUndefined();
    expect(week.alternates?.canonical).toBe("https://shipkudos.com/leaderboard");
    expect(month.alternates?.canonical).toBe(
      "https://shipkudos.com/leaderboard?period=30",
    );
  });
});

describe("titles and descriptions", () => {
  it("uses the launch keywords and a distinct description on every public page", () => {
    expect(rootMetadata().title).toEqual({
      default:
        "ShipKudos — Leaderboard for developers shipping with AI coding agents",
      template: "%s · ShipKudos",
    });
    expect(rootMetadata().robots).toBeUndefined();
    expect(rootMetadata().description).toBeUndefined();
    const layout = readFileSync(
      new URL("../../src/app/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).not.toContain("robots:");
    expect(leaderboardMetadata({}).title).toBe(
      "Top builders shipping with AI agents (7 days)",
    );
    expect(leaderboardMetadata({ period: "30" }).title).toBe(
      "Top builders shipping with AI agents (30 days)",
    );
    expect(infoMetadata("methodology")?.title).toBe("How the ranking works");
    expect(infoMetadata("privacy")?.title).toBe("Privacy policy");
    expect(infoMetadata("terms")?.title).toBe("Terms of use");
    const ranked = {
      name: "Sergio Navarro",
      login: "navarrillo",
      tools: ["Codex", "Cursor", "Grok"],
    };
    expect(
      profileTitle({ ...ranked, tools: [...ranked.tools, "Claude Code"] }),
    ).toBe("Sergio Navarro (@navarrillo) — ships with Codex + Cursor + Grok");
    expect(profileDescription(ranked, { score: 109, position: 1 })).toBe(
      "Sergio Navarro (@navarrillo): 109 public GitHub contributions in 7 days, #1 on ShipKudos. Ships with Codex, Cursor, Grok.",
    );
    const descriptions = [
      homeMetadata().description,
      leaderboardMetadata({}).description,
      leaderboardMetadata({ period: "30" }).description,
      agentsMetadata().description,
      advertiseMetadata().description,
      infoMetadata("methodology")?.description,
      infoMetadata("privacy")?.description,
      infoMetadata("terms")?.description,
      profileDescription(ranked, { score: 109, position: 1 }),
      profileDescription(
        { name: "New Builder", login: "new-builder", tools: [] },
        undefined,
      ),
    ];
    expect(descriptions.every((description) => description && description.length > 40)).toBe(
      true,
    );
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
