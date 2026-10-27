import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createMetadataElements } from "next/dist/lib/metadata/metadata-elements.js";
import { resolveRobots } from "next/dist/build/webpack/loaders/metadata/resolve-route-data.js";
import type { Metadata } from "next";
import { homeMetadata } from "../../src/lib/seo";
import {
  profileSocialMetadata,
  socialCardResponse,
  withSocial,
} from "../../src/lib/social";
import robots from "../../src/app/robots";
import { avatarBufferToDataUri } from "../../src/lib/avatar-image";
import { generateMetadata as homePageMetadata } from "../../src/app/page";
import { generateMetadata as profilePageMetadata } from "../../src/app/u/[login]/page";

const previous = {
  APP_URL: process.env.APP_URL,
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
};
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
function useApp(url = "https://cards.example", name = "PreviewName") {
  process.env.APP_URL = url;
  process.env.APP_NAME = name;
}
function tagsOf(metadata: Metadata) {
  const elements = createMetadataElements({
    title: "",
    description: metadata.description ?? null,
    openGraph: metadata.openGraph ?? null,
    twitter: metadata.twitter ?? null,
  } as Parameters<typeof createMetadataElements>[0]);
  const tags = new Map<string, string>();
  for (const element of elements) {
    const props = element.props as {
      property?: string;
      name?: string;
      content?: string;
    };
    const key = props.property || props.name;
    if (key && props.content && !tags.has(key)) tags.set(key, props.content);
  }
  return tags;
}
const required = [
  "og:title",
  "og:description",
  "og:url",
  "og:type",
  "og:site_name",
  "og:image",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:card",
  "twitter:image",
] as const;

describe("home page preview tags", () => {
  it("emits a large card whose absolute URLs come from APP_URL", () => {
    useApp();
    const metadata = withSocial(homeMetadata());
    const tags = tagsOf(metadata);
    for (const name of required) expect(tags.get(name), name).toBeTruthy();
    expect(tags.get("og:title")).toBe(
      "PreviewName — Leaderboard for developers shipping with AI coding agents",
    );
    expect(tags.get("og:description")).toBe(homeMetadata().description);
    expect(tags.get("og:url")).toBe(homeMetadata().alternates?.canonical);
    expect(tags.get("og:type")).toBe("website");
    expect(tags.get("og:site_name")).toBe("PreviewName");
    expect(tags.get("og:image")).toBe("https://cards.example/og.png");
    expect(tags.get("og:image:width")).toBe("1200");
    expect(tags.get("og:image:height")).toBe("630");
    expect(tags.get("og:image:alt")).toContain("PreviewName");
    expect(tags.get("twitter:card")).toBe("summary_large_image");
    expect(tags.get("twitter:image")).toBe("https://cards.example/og.png");
    expect([...tags.values()].join(" ")).not.toContain("shipkudos.com");
  });
  it("uses the same tags on the home page", () => {
    useApp();
    expect(tagsOf(homePageMetadata())).toEqual(tagsOf(withSocial(homeMetadata())));
  });
});

describe("profile page preview tags", () => {
  const profile = {
    profile: {
      name: "Ada Lovelace",
      login: "ada",
      tools: ["Codex"],
      last_sync_at: null,
    },
    days: [] as {
      day: string;
      commits: number;
      prs: number;
      issues: number;
      reviews: number;
      score: number;
    }[],
    ranks: [
      {
        period: 7,
        score: 1240,
        position: 3,
        active_days: 4,
        commits: 10,
        prs: 2,
        total: 40,
        snapshot_id: "snap-1",
      },
    ],
  };
  it("matches the page description and canonical, and versions the card", () => {
    useApp();
    const tags = tagsOf(profileSocialMetadata(profile));
    for (const name of required) expect(tags.get(name), name).toBeTruthy();
    expect(tags.get("og:title")).toBe(
      "Ada Lovelace (@ada) — ships with Codex · PreviewName",
    );
    expect(tags.get("og:description")).toBe(
      "Ada Lovelace (@ada): 1,240 public GitHub contributions in 7 days, #3 on PreviewName. Ships with Codex.",
    );
    expect(tags.get("og:url")).toBe("https://cards.example/u/ada");
    expect(tags.get("og:image")).toBe(
      "https://cards.example/api/og/ada?period=7&v=snap-1",
    );
    expect(tags.get("og:image:width")).toBe("1200");
    expect(tags.get("og:image:height")).toBe("630");
    expect(tags.get("og:image:alt")).toContain("@ada");
    expect(tags.get("twitter:card")).toBe("summary_large_image");
    expect([...tags.values()].join(" ")).not.toContain("shipkudos.com");
  });
  it("uses the default card when the profile page has no published builder", async () => {
    useApp();
    delete process.env.DATABASE_URL;
    const tags = tagsOf(
      await profilePageMetadata({
        params: Promise.resolve({ login: "ada" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(tags.get("og:image")).toBe("https://cards.example/og.png");
    expect(tags.get("og:url")).toBe("https://cards.example/u/ada");
    expect(tags.get("twitter:card")).toBe("summary_large_image");
    expect(tags.get("og:title")).toContain("Builder not found");
  });
});

describe("default card fallback", () => {
  it("is a 1200 by 630 PNG", async () => {
    const meta = await sharp("public/og.png").metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
  });
  it("serves the default card when rendering is busy or fails", async () => {
    const busy = await socialCardResponse(null);
    expect(busy.status).toBe(200);
    expect(busy.headers.get("content-type")).toContain("image/png");
    expect(busy.headers.get("cache-control")).toBe("no-store");
    const failed = await socialCardResponse(Promise.reject(new Error("render failed")));
    expect(failed.status).toBe(200);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    const png = Buffer.from(await busy.arrayBuffer());
    expect((await sharp(png).metadata()).width).toBe(1200);
    const rendered = new Uint8Array([9, 8, 7]).buffer;
    const ok = await socialCardResponse(rendered);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=300");
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(Buffer.from(rendered));
  });
  it("turns a WebP avatar into a PNG data URI that the card renderer can draw", async () => {
    const webp = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#b9f36a" },
    })
      .webp()
      .toBuffer();
    const uri = await avatarBufferToDataUri(webp);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    const meta = await sharp(
      Buffer.from(uri.slice("data:image/png;base64,".length), "base64"),
    ).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
  });
  it("lets crawlers fetch profile cards while the rest of the API stays private", () => {
    const text = resolveRobots(robots());
    const allow = text.indexOf("Allow: /api/og/");
    const disallow = text.indexOf("Disallow: /api/");
    expect(allow).toBeGreaterThanOrEqual(0);
    expect(disallow).toBeGreaterThan(allow);
    expect(text).toContain("Allow: /\n");
    expect(text).toContain("Disallow: /admin");
    expect(text).not.toContain("Disallow: /api/og/");
  });
});
