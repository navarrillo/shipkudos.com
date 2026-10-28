import { publicProfile } from "@/lib/profile-data";
import { renderAndStoreProfileCard, storedProfileCard } from "@/lib/profile-cards";
import { socialCardResponse } from "@/lib/social";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ login: string }> },
) {
  const { login } = await params;
  const query = new URL(request.url).searchParams;
  const period = query.get("period") === "30" ? 30 : 7;
  const version = query.get("v") || null;
  const respond = (bytes: Uint8Array | ArrayBuffer) =>
    new Response(
      bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes),
      {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": version
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400, stale-while-revalidate=604800",
        },
      },
    );
  if (!/^[a-z0-9-]{1,39}$/i.test(login)) return socialCardResponse(null);
  try {
    try {
      const stored = await storedProfileCard(login, period, version);
      if (stored) return respond(stored.png);
    } catch {
      // Storage is optional for the on-demand fallback.
    }
    const data = await publicProfile(login);
    if (data) {
      const { bytes } = await renderAndStoreProfileCard(data, period);
      if (bytes) return respond(bytes);
    }
  } catch {
    console.error(JSON.stringify({ event: "share_card_fallback", login, period }));
  }
  return socialCardResponse(null);
}
