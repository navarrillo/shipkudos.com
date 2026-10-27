import React from "react";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageResponse } from "next/og";
import {
  cardFonts,
  cardFooter,
  cardLogin,
  cardName,
  ProfileCard,
} from "../../src/lib/profile-card";

const name = "N".repeat(48);
const login = "l".repeat(39);

describe("profile card text", () => {
  it("cuts a long name at 26 characters, including the ellipsis", () => {
    expect(cardName(name)).toBe(`${"N".repeat(25)}…`);
    expect(Array.from(cardName(name)).length).toBe(26);
    expect(cardName("Ada Lovelace")).toBe("Ada Lovelace");
  });
  it("keeps a 39-character login on one line", () => {
    const handle = cardLogin(login);
    expect(handle.text).toBe(login);
    expect(handle.fontSize).toBeLessThanOrEqual(16);
    expect(cardLogin(`${login}x`).text.endsWith("…")).toBe(true);
  });
  it("keeps the footer URL inside the space beside the 30-day strip", () => {
    const footer = cardFooter("shipkudos.com", login);
    expect(footer.text.startsWith("shipkudos.com/u/")).toBe(true);
    expect(footer.text).not.toBe(`shipkudos.com/u/${login}`);
    expect(footer.text.endsWith("…")).toBe(true);
    expect(footer.text.length * footer.fontSize * 0.75).toBeLessThanOrEqual(
      1200 - 128 - (30 * 18 + 29 * 5) - 32,
    );
  });
});

describe("profile card render", () => {
  it("renders a 39-character login and a 48-character name inside the card", async () => {
    const png = Buffer.from(
      await new ImageResponse(
        React.createElement(ProfileCard, {
          appName: "ShipKudos",
          host: "shipkudos.com",
          login,
          name,
          avatar: null,
          tools: ["Claude Code", "Cursor", "Codex"],
          period: 30,
          position: 6,
          total: 140,
          score: 412,
          activeDays: 22,
          prs: 57,
          streak: 12,
          scores: Array.from({ length: 30 }, (_, index) => (index % 4 === 0 ? 0 : 8)),
        }),
        { width: 1200, height: 630, fonts: cardFonts },
      ).arrayBuffer(),
    );
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const index = (y * info.width + x) * info.channels;
      return [data[index], data[index + 1], data[index + 2]] as const;
    };
    for (const y of [560, 590, 610]) {
      const [red, green, blue] = pixel(1188, y);
      expect(red).toBeLessThan(30);
      expect(green).toBeLessThan(40);
      expect(blue).toBeLessThan(40);
    }
  });
});
