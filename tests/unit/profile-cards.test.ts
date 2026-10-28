import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  publicProfile: vi.fn(),
  render: vi.fn(),
  version: vi.fn(),
}));
vi.mock("../../src/db", () => ({ sql: mocks.sql }));
vi.mock("../../src/lib/profile-data", () => ({
  publicProfile: mocks.publicProfile,
}));
vi.mock("../../src/lib/render-profile-card", () => ({
  profileCardVersion: mocks.version,
  renderProfileCard: mocks.render,
}));
import { GET } from "../../src/app/api/og/[login]/route";
import {
  backfillProfileCards,
  renderProfileCards,
  storedShareLinks,
} from "../../src/lib/profile-cards";
import { socialImages } from "../../src/lib/social-image";

const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
const data = {
  profile: {
    id: "owner",
    login: "ada",
    name: "Ada",
    avatar: null,
    tools: [],
    last_sync_at: null,
  },
  days: [],
  ranks: [],
};
let run = 0;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/unused");
  mocks.sql.mockResolvedValue([]);
  mocks.publicProfile.mockResolvedValue(data);
  mocks.version.mockImplementation((_data, period) => `${++run}-${period}`);
  mocks.render.mockResolvedValue(bytes);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const get = (query = "", login = "ada") =>
  GET(new Request(`http://localhost/api/og/${login}${query}`), {
    params: Promise.resolve({ login }),
  });

describe("stored card route", () => {
  it("serves a stored version without reading profile data or invoking the renderer", async () => {
    mocks.sql.mockResolvedValueOnce([
      { version: "ready", png: Buffer.from(bytes) },
    ]);
    const response = await get("?period=30&v=ready");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await response.arrayBuffer()).toEqual(bytes);
    expect(mocks.sql.mock.calls[0][1]).toEqual(["ada", 30, "ready"]);
    expect(mocks.publicProfile).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("renders a miss, stores it, and serves a subsequent hit", async () => {
    const response = await get("?period=7");
    expect(await response.arrayBuffer()).toEqual(bytes);
    expect(mocks.render).toHaveBeenCalledOnce();
    const insert = mocks.sql.mock.calls.find(([query]) =>
      query.includes("INSERT INTO profile_share_cards"),
    );
    expect(insert?.[1]).toEqual([
      "owner",
      7,
      expect.any(String),
      Buffer.from(bytes),
      expect.any(Date),
    ]);
    mocks.sql.mockResolvedValueOnce([
      { version: insert![1][2], png: Buffer.from(bytes) },
    ]);
    expect(
      await (await get(`?period=7&v=${insert![1][2]}`)).arrayBuffer(),
    ).toEqual(bytes);
    expect(mocks.render).toHaveBeenCalledOnce();
  });
  it("re-renders a stale v instead of serving a different stored version", async () => {
    await get("?period=30&v=stale");
    expect(mocks.sql.mock.calls[0][1]).toEqual(["ada", 30, "stale"]);
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(
      mocks.sql.mock.calls.some(([query]) =>
        query.includes("INSERT INTO profile_share_cards"),
      ),
    ).toBe(true);
  });
  it("serves a PNG even when storage is unavailable", async () => {
    mocks.sql.mockRejectedValue(new Error("database unavailable"));
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(bytes);
  });
  it("keeps the default PNG for unknown builders, errors and render saturation", async () => {
    mocks.publicProfile.mockResolvedValueOnce(null);
    for (let step = 0; step < 3; step++) {
      if (step === 1)
        mocks.render.mockRejectedValueOnce(new Error("render failed"));
      if (step === 2) vi.spyOn(socialImages, "get").mockResolvedValueOnce(null);
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(Buffer.from(await response.arrayBuffer()).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
  });
});

describe("worker cards and sharing", () => {
  it("renders and persists both periods for a published profile", async () => {
    mocks.sql.mockResolvedValueOnce([{ login: "ada" }]);
    await renderProfileCards("owner");
    expect(mocks.render.mock.calls.map((call) => call[1])).toEqual([7, 30]);
    expect(
      mocks.sql.mock.calls.filter(([query]) =>
        query.includes("INSERT INTO profile_share_cards"),
      ),
    ).toHaveLength(2);
  });
  it("retries a worker render when PNG storage fails", async () => {
    mocks.sql
      .mockResolvedValueOnce([{ login: "ada" }])
      .mockRejectedValueOnce(new Error("write failed"));
    await expect(renderProfileCards("owner")).rejects.toThrow(
      "share_card_not_stored",
    );
  });
  it("ignores profiles that have been hidden or unpublished", async () => {
    await renderProfileCards("hidden");
    expect(mocks.publicProfile).not.toHaveBeenCalled();
  });
  it("backfills every published visible profile through deduplicated worker jobs", async () => {
    mocks.sql.mockResolvedValueOnce([{ id: "one" }, { id: "two" }]);
    const send = vi.fn();
    expect(await backfillProfileCards({ send } as unknown as PgBoss)).toBe(2);
    expect(mocks.sql.mock.calls[0][0]).toContain(
      "published_at IS NOT NULL AND p.hidden_at IS NULL",
    );
    expect(send.mock.calls).toEqual([
      [
        "profile-cards",
        { profileId: "one" },
        expect.objectContaining({ singletonKey: "one" }),
      ],
      [
        "profile-cards",
        { profileId: "two" },
        expect.objectContaining({ singletonKey: "two" }),
      ],
    ]);
  });
  it("uses only a stored v while a new image is preparing", async () => {
    mocks.sql.mockResolvedValueOnce([{ version: "already-rendered" }]);
    expect((await storedShareLinks(data, 30)).imageUrl).toContain(
      "period=30&v=already-rendered",
    );
    expect((await storedShareLinks(data, 7)).imageUrl).not.toContain("v=");
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
