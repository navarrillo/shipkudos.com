import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resolveRobots } from "next/dist/build/webpack/loaders/metadata/resolve-route-data.js";
import { Analytics } from "../../src/components/analytics";
import { StagingMark } from "../../src/components/staging-mark";
import robots from "../../src/app/robots";
import {
  outboundEnabled,
  outboundLocation,
} from "../../src/lib/runtime";
import { canonicalUrl, leaderboardMetadata, rootMetadata } from "../../src/lib/seo";
import { shareLinks } from "../../src/lib/share";
import { umamiScript } from "../../src/lib/umami";
import { proxy } from "../../src/proxy";

const keys = [
  "APP_ENV",
  "APP_URL",
  "APP_NAME",
  "UMAMI_WEBSITE_ID",
  "UMAMI_STAGING_WEBSITE_ID",
  "UMAMI_SCRIPT_URL",
  "STAGING_OUTBOUND",
  "DATABASE_URL",
] as const;
const previous = new Map(keys.map((key) => [key, process.env[key]]));
const env = process.env as Record<string, string | undefined>;
afterEach(() => {
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

function clearOptional() {
  delete env.APP_ENV;
  delete env.STAGING_OUTBOUND;
  delete env.UMAMI_WEBSITE_ID;
  delete env.UMAMI_STAGING_WEBSITE_ID;
  delete env.UMAMI_SCRIPT_URL;
  delete env.DATABASE_URL;
}
function productionEnv() {
  clearOptional();
  env.APP_URL = "https://shipkudos.com";
  env.APP_NAME = "ShipKudos";
}
function stagingEnv() {
  clearOptional();
  env.APP_ENV = "staging";
  env.APP_URL = "https://staging.shipkudos.com";
  env.APP_NAME = "ShipKudos";
}
const shareInput = {
  profile: {
    login: "ada",
    name: "Ada",
    tools: ["Codex"],
    last_sync_at: null,
  },
  days: [],
  ranks: [],
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return [full];
  });
}

describe("staging flag", () => {
  it("matches current production robots, headers, metadata, and analytics when unset", () => {
    productionEnv();
    const text = resolveRobots(robots());
    expect(text).toContain("Allow: /\n");
    expect(text).toContain("Allow: /api/og/");
    expect(text).toContain("Disallow: /api/");
    expect(text).toContain("Disallow: /admin");
    expect(text).toContain("Sitemap: https://shipkudos.com/sitemap.xml");
    expect(rootMetadata().robots).toBeUndefined();
    expect(leaderboardMetadata({}).robots).toBeUndefined();
    expect(leaderboardMetadata({ q: "ada" }).robots).toEqual({ index: false });
    const home = proxy(new NextRequest("https://shipkudos.com/"));
    expect(home.headers.get("x-robots-tag")).toBeNull();
    const redirect = proxy(new NextRequest("https://shipkudos.com/u/Ada"));
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe("https://shipkudos.com/u/ada");
    expect(redirect.headers.get("x-robots-tag")).toBeNull();
    expect(umamiScript()).toBeNull();
    expect(renderToStaticMarkup(createElement(Analytics))).toBe("");
    expect(renderToStaticMarkup(createElement(StagingMark))).toBe("");
    expect(outboundEnabled()).toBe(true);
    expect(outboundLocation("https://ads.example/landing")).toBe(
      "https://ads.example/landing",
    );
    const links = shareLinks(shareInput, 7);
    expect(links.profileUrl).toBe("https://shipkudos.com/u/ada");
    const intent = new URL(links.intentUrl);
    expect(`${intent.origin}${intent.pathname}`).toBe("https://x.com/intent/post");
    expect(intent.searchParams.get("url")).toBe("https://shipkudos.com/u/ada");
  });

  it("blocks indexing and analytics on staging and shares the staging profile", () => {
    stagingEnv();
    env.UMAMI_WEBSITE_ID = "prod-website";
    const text = resolveRobots(robots());
    expect(text).not.toContain("Allow:");
    expect(text).not.toContain("Disallow: /api");
    expect(text).not.toContain("Sitemap:");
    expect(text).toMatch(/Disallow: \/\s*$/);
    expect(text).not.toContain("shipkudos.com");
    expect(rootMetadata().robots).toEqual({ index: false, follow: false });
    expect(leaderboardMetadata({}).robots).toBeUndefined();
    expect(leaderboardMetadata({ q: "ada" }).robots).toEqual({
      index: false,
      follow: false,
    });
    expect(canonicalUrl("/leaderboard")).toBe(
      "https://staging.shipkudos.com/leaderboard",
    );
    expect(canonicalUrl("/")).toBe("https://staging.shipkudos.com");
    const home = proxy(new NextRequest("https://staging.shipkudos.com/robots.txt"));
    expect(home.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(home.headers.get("location")).toBeNull();
    const redirect = proxy(
      new NextRequest("http://127.0.0.1:3000/u/Ada?period=7"),
    );
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe(
      "https://staging.shipkudos.com/u/ada?period=7",
    );
    expect(redirect.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(umamiScript()).toBeNull();
    expect(renderToStaticMarkup(createElement(Analytics))).toBe("");
    const banner = renderToStaticMarkup(createElement(StagingMark));
    expect(banner).toContain("Staging");
    expect(banner).toContain("staging.shipkudos.com");
    expect(banner).not.toContain("https://shipkudos.com");
    expect(outboundEnabled()).toBe(false);
    expect(outboundLocation("https://ads.example/landing")).toBe(
      "https://staging.shipkudos.com",
    );
    const links = shareLinks(shareInput, 7);
    expect(links.profileUrl).toBe("https://staging.shipkudos.com/u/ada");
    const intent = new URL(links.intentUrl);
    expect(`${intent.origin}${intent.pathname}`).toBe("https://x.com/intent/post");
    expect(intent.searchParams.get("url")).toBe(
      "https://staging.shipkudos.com/u/ada",
    );
    expect(links.imageUrl.startsWith("https://staging.shipkudos.com/api/og/")).toBe(
      true,
    );
  });

  it("uses a staging Umami website id only when one is provided", () => {
    stagingEnv();
    env.UMAMI_WEBSITE_ID = "prod-website";
    env.UMAMI_STAGING_WEBSITE_ID = "stage-website";
    expect(umamiScript()).toEqual({
      src: "https://cloud.umami.is/script.js",
      websiteId: "stage-website",
    });
    const html = renderToStaticMarkup(createElement(Analytics));
    expect(html).toContain('data-website-id="stage-website"');
    expect(html).toContain("https://cloud.umami.is/script.js");
    expect(html).not.toContain("prod-website");
    env.UMAMI_SCRIPT_URL = "http://analytics.example/script.js";
    expect(umamiScript()).toBeNull();
    env.UMAMI_SCRIPT_URL = "https://analytics.example/script.js";
    expect(umamiScript()?.src).toBe("https://analytics.example/script.js");
  });

  it("loads Umami in production only from UMAMI_WEBSITE_ID", () => {
    productionEnv();
    env.UMAMI_STAGING_WEBSITE_ID = "stage-website";
    expect(umamiScript()).toBeNull();
    env.UMAMI_WEBSITE_ID = "prod-website";
    expect(umamiScript()).toEqual({
      src: "https://cloud.umami.is/script.js",
      websiteId: "prod-website",
    });
    env.STAGING_OUTBOUND = "true";
    expect(outboundEnabled()).toBe(true);
  });

  it("enables staging outbound only when asked", () => {
    stagingEnv();
    for (const value of ["", "false", "0", "no"]) {
      env.STAGING_OUTBOUND = value;
      expect(outboundEnabled()).toBe(false);
    }
    for (const value of ["1", "true", "TRUE", "yes"]) {
      env.STAGING_OUTBOUND = value;
      expect(outboundEnabled()).toBe(true);
    }
    expect(outboundLocation("https://ads.example/landing")).toBe(
      "https://ads.example/landing",
    );
  });
});

describe("staging source and workflow", () => {
  it("keeps the production origin out of application source", () => {
    const hits = filesUnder(path.resolve("src")).filter((file) => {
      if (!/\.(ts|tsx|js|jsx|css)$/.test(file)) return false;
      const text = readFileSync(file, "utf8");
      return /https?:\/\/(www\.)?shipkudos\.com(?![\w.-])/.test(text);
    });
    expect(hits).toEqual([]);
  });

  it("publishes a development channel without touching the production workflow", () => {
    const staging = readFileSync(".github/workflows/staging.yml", "utf8");
    const main = readFileSync(".github/workflows/main.yml", "utf8");
    const heavy = readFileSync(".github/workflows/heavy.yml", "utf8");
    expect(staging).toContain("branches: [development]");
    expect(staging).toContain("group: staging-release");
    expect(staging).not.toContain("production-release");
    expect(staging).toContain("publish: true");
    expect(staging).toContain("channel: development");
    expect(staging).not.toContain("latest");
    expect(main).toContain("branches: [main]");
    expect(main).toContain("group: production-release");
    expect(main).toContain("publish: true");
    expect(main).not.toContain("channel:");
    expect(heavy).toContain("latest|main");
    expect(heavy).toContain("${CHANNEL}-${GITHUB_SHA}");
    expect(heavy).toContain('image="${image_repo}:${GITHUB_SHA}"');
  });
});
