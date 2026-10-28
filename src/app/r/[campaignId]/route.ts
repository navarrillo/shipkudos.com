import { recordAdEvent } from "@/lib/ads";
import { route, HttpError, rateLimit, clientKey } from "@/lib/http";
import { outboundLocation } from "@/lib/runtime";
export const GET = route(
  async (
    request: Request,
    context: { params: Promise<{ campaignId: string }> },
  ) => {
    await rateLimit(`click:${clientKey(request)}`, 120, 60);
    if (/bot|crawler|spider/i.test(request.headers.get("user-agent") || ""))
      throw new HttpError(403, "automated_traffic");
    const { campaignId } = await context.params;
    const target = await recordAdEvent(
      new URL(request.url).searchParams.get("token") || "",
      "click",
      campaignId,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: outboundLocation(target), "Cache-Control": "no-store" },
    });
  },
);
