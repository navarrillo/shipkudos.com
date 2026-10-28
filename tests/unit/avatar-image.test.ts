import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  allowedAvatarUrl,
  cachedAvatarPng,
  fetchAvatarPng,
  MAX_AVATAR_BYTES,
} from "../../src/lib/avatar-image";

const png = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "#b9f36a" },
})
  .png()
  .toBuffer();

function response(body: Buffer, headers: Record<string, string> = {}) {
  let read = false;
  return {
    read: () => read,
    response: {
      ok: true,
      headers: new Headers(headers),
      arrayBuffer: async () => {
        read = true;
        return Uint8Array.from(body).buffer;
      },
    },
  };
}

describe("avatar fetch", () => {
  it("rejects other hosts and plain http", async () => {
    const fetchImpl = vi.fn();
    expect(allowedAvatarUrl("https://example.com/a.png")).toBeNull();
    expect(
      allowedAvatarUrl("http://avatars.githubusercontent.com/u/1"),
    ).toBeNull();
    expect(
      await fetchAvatarPng("https://evil.example/a.png", fetchImpl),
    ).toBeNull();
    expect(
      await fetchAvatarPng(
        "http://avatars.githubusercontent.com/u/1",
        fetchImpl,
      ),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not follow redirects", async () => {
    const fetchImpl = vi.fn(async (_url: URL, init: { redirect: string }) => {
      expect(init.redirect).toBe("error");
      throw new TypeError("redirect");
    });
    expect(
      await fetchAvatarPng(
        "https://avatars.githubusercontent.com/u/1",
        fetchImpl,
      ),
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("ignores a response over 1 MB", async () => {
    const tooBig = response(png, {
      "content-length": String(MAX_AVATAR_BYTES + 1),
    });
    const fetchImpl = vi.fn(async () => tooBig.response);
    expect(
      await fetchAvatarPng(
        "https://avatars.githubusercontent.com/u/1",
        fetchImpl,
      ),
    ).toBeNull();
    expect(tooBig.read()).toBe(false);
    const unmarked = response(Buffer.alloc(MAX_AVATAR_BYTES + 1));
    const fetchBody = vi.fn(async () => unmarked.response);
    expect(
      await fetchAvatarPng(
        "https://avatars.githubusercontent.com/u/9",
        fetchBody,
      ),
    ).toBeNull();
  });
});

it("fetches a PNG once per avatar URL across periods and concurrent worker jobs", async () => {
  const fetchImpl = vi.fn(
    async (url: URL, init: { headers: { Accept: string } }) => {
      expect(url.searchParams.get("f")).toBe("png");
      expect(init.headers.Accept).toBe("image/png");
      return new Response(Uint8Array.from(png));
    },
  );
  vi.stubGlobal("fetch", fetchImpl);
  try {
    const url = "https://avatars.githubusercontent.com/u/987654321";
    const [week, month] = await Promise.all([
      cachedAvatarPng(url),
      cachedAvatarPng(url),
    ]);
    expect(week).toBe(month);
    expect(week).toMatch(/^data:image\/png;base64,/);
    expect(await cachedAvatarPng(url)).toBe(week);
    expect(fetchImpl).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
