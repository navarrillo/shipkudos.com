import sharp from "sharp";

export const MAX_AVATAR_BYTES = 1048576;

/** resvg, used by next/og, does not draw WebP. Always hand it a PNG. */
export async function avatarBufferToDataUri(input: ArrayBuffer | Buffer) {
  const png = await sharp(input, { limitInputPixels: 1000000 })
    .resize(128, 128)
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export function allowedAvatarUrl(value: string | null): URL | null {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "avatars.githubusercontent.com")
    return null;
  url.searchParams.set("s", "128");
  url.searchParams.set("f", "png");
  return url;
}

export async function fetchAvatarPng(
  value: string | null,
  doFetch: (
    input: URL,
    init: { signal: AbortSignal; redirect: "error"; headers: { Accept: string } },
  ) => Promise<Pick<Response, "ok" | "headers" | "arrayBuffer">> = fetch,
): Promise<string | null> {
  const url = allowedAvatarUrl(value);
  if (!url) return null;
  try {
    const response = await doFetch(url, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
      headers: { Accept: "image/png" },
    });
    if (!response.ok) return null;
    if (Number(response.headers.get("content-length") || 0) > MAX_AVATAR_BYTES)
      return null;
    const input = await response.arrayBuffer();
    if (input.byteLength > MAX_AVATAR_BYTES) return null;
    return await avatarBufferToDataUri(input);
  } catch {
    return null;
  }
}

// Share the decoded PNG across the two periods and subsequent jobs in this process.
// Bound the cache so a large backfill cannot grow worker memory without limit.
const avatars = new Map<string, Promise<string | null>>();
export function cachedAvatarPng(value: string | null) {
  if (!value) return Promise.resolve(null);
  const hit = avatars.get(value);
  if (hit) return hit;
  if (avatars.size >= 512) avatars.delete(avatars.keys().next().value!);
  const pending = fetchAvatarPng(value).then((png) => {
    if (!png) avatars.delete(value);
    return png;
  });
  avatars.set(value, pending);
  return pending;
}
