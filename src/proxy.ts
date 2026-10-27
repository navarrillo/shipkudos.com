import { NextResponse, type NextRequest } from "next/server";
import { profilePathRedirect } from "@/lib/seo";

export function proxy(request: NextRequest) {
  const target = profilePathRedirect(
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, request.url), 308);
}

export const config = { matcher: "/u/:login" };
