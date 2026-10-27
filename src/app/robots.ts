import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/dashboard", "/agents/authorize/"],
      },
    ],
    sitemap: `${config().APP_URL}/sitemap.xml`,
  };
}
