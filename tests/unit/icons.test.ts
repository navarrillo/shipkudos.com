import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { createMetadataElements } from "next/dist/lib/metadata/metadata-elements.js";
import { resolveAppleWebApp } from "next/dist/lib/metadata/resolvers/resolve-basics.js";
import { resolveIcons } from "next/dist/lib/metadata/resolvers/resolve-icons.js";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path.js";
import { rootMetadata } from "../../src/lib/seo";
import { config as proxyConfig, proxy } from "../../src/proxy";

const previousUrl = process.env.APP_URL;
const previousName = process.env.APP_NAME;
const previousEnv = process.env.APP_ENV;
process.env.APP_URL = "https://shipkudos.com";
process.env.APP_NAME = "ShipKudos";
delete process.env.APP_ENV;

afterAll(() => {
  if (previousUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousUrl;
  if (previousName === undefined) delete process.env.APP_NAME;
  else process.env.APP_NAME = previousName;
  if (previousEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = previousEnv;
});

const rootFiles = [
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/favicon.ico",
  "/site.webmanifest",
] as const;

const siteBackground = [0x0b, 0x0c, 0x0d];
const logoFill = [0xb9, 0xf3, 0x6a];
const logoStroke = [0x16, 0x21, 0x0d];

function rgbAt(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
) {
  const index = (y * width + x) * channels;
  return [data[index], data[index + 1], data[index + 2]];
}

describe("home screen icons", () => {
  it("keeps the favicon and adds the apple icon, manifest, and title", () => {
    const metadata = rootMetadata();
    expect(metadata.icons).toEqual({
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [
        {
          url: "/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    });
    expect(metadata.manifest).toBe("/site.webmanifest");
    expect(metadata.appleWebApp).toEqual({ capable: true, title: "ShipKudos" });
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createMetadataElements({
          icons: resolveIcons(metadata.icons),
          manifest: metadata.manifest,
          appleWebApp: resolveAppleWebApp(metadata.appleWebApp),
        } as Parameters<typeof createMetadataElements>[0]),
      ),
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png"',
    );
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest"');
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-title" content="ShipKudos"',
    );
    expect(html).toContain('<link rel="icon" href="/icon.svg"');
    expect(readFileSync("src/app/icon.svg", "utf8")).toContain('fill="#b9f36a"');
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("rootMetadata()");
  });

  it("serves an opaque logo on the site background at each icon size", async () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--bg: #0b0c0d");
    expect(css).toContain("--lime: #b9f36a");
    const logo = readFileSync("src/app/icon.svg", "utf8");
    expect(logo).toContain('fill="#b9f36a"');
    expect(logo).toContain('stroke="#16210d"');
    for (const [file, size] of [
      ["public/apple-touch-icon.png", 180],
      ["public/icon-192.png", 192],
      ["public/icon-512.png", 512],
    ] as const) {
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
      expect(meta.hasAlpha).toBe(false);
      expect(meta.channels).toBe(3);
      const { data, info } = await sharp(file)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(3);
      const pad = Math.round(size * 0.1);
      const scale = (size - pad * 2) / 64;
      expect(
        rgbAt(data, info.width, info.channels, 0, 0),
      ).toEqual(siteBackground);
      expect(
        rgbAt(data, info.width, info.channels, 4, Math.floor(size / 2)),
      ).toEqual(siteBackground);
      expect(
        rgbAt(
          data,
          info.width,
          info.channels,
          Math.floor(size / 2),
          Math.floor(size / 2),
        ),
      ).toEqual(logoFill);
      expect(
        rgbAt(
          data,
          info.width,
          info.channels,
          Math.round(pad + 32 * scale),
          Math.round(pad + 24 * scale),
        ),
      ).toEqual(logoStroke);
    }
  });

  it("publishes a manifest whose colors match the site", () => {
    const manifest = JSON.parse(
      readFileSync("public/site.webmanifest", "utf8"),
    );
    expect(manifest).toMatchObject({
      name: "ShipKudos",
      short_name: "ShipKudos",
      start_url: "/",
      display: "standalone",
      theme_color: "#0b0c0d",
      background_color: "#0b0c0d",
    });
    expect(manifest.icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
  });

  it("does not send root icon or manifest requests through the proxy", () => {
    const parsed = tryToParsePath(proxyConfig.matcher[0]);
    expect(parsed.error).toBeUndefined();
    const matcher = new RegExp(parsed.regexStr!);
    for (const pathname of rootFiles) {
      expect(matcher.test(pathname), pathname).toBe(false);
      const response = proxy(new NextRequest(`https://shipkudos.com${pathname}`));
      expect(response.status).not.toBe(308);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
    expect(matcher.test("/leaderboard")).toBe(true);
    expect(matcher.test("/")).toBe(true);
    process.env.APP_ENV = "staging";
    const staged = proxy(
      new NextRequest("https://staging.shipkudos.com/apple-touch-icon.png"),
    );
    expect(staged.headers.get("location")).toBeNull();
    expect(staged.status).not.toBe(308);
    delete process.env.APP_ENV;
  });
});
