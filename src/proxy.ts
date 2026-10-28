import { NextResponse, type NextRequest } from "next/server";
import { isStaging } from "@/lib/runtime";
import { canonicalUrl, profilePathRedirect } from "@/lib/seo";

export function proxy(request: NextRequest) {
  const target = profilePathRedirect(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  const response = target
    ? NextResponse.redirect(canonicalUrl(target), 308)
    : NextResponse.next();
  if (isStaging()) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
