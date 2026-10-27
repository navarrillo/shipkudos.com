import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { sql } from "@/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = config().APP_URL;
  const routes = [
    "",
    "/leaderboard",
    "/agents",
    "/advertise",
    "/methodology",
  ].map((route) => ({ url: base + route }));
  if (!process.env.DATABASE_URL) return routes;
  const profiles = await sql(
    "SELECT login,last_sync_at FROM profiles WHERE published_at IS NOT NULL AND hidden_at IS NULL ORDER BY login LIMIT 49000",
  );
  return [
    ...routes,
    ...profiles.map((p) => ({
      url: `${base}/u/${p.login}`,
      lastModified: p.last_sync_at || undefined,
    })),
  ];
}
