import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/seo";
import { isStaging } from "@/lib/runtime";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  if (isStaging()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/og/"],
        disallow: ["/api/", "/admin", "/dashboard", "/agents/authorize/"],
      },
    ],
    sitemap: canonicalUrl("/sitemap.xml"),
  };
}
