import { isStaging } from "./runtime";

const DEFAULT_SRC = "https://cloud.umami.is/script.js";
const WEBSITE_ID = /^[A-Za-z0-9-]{8,64}$/;

function scriptUrl() {
  const configured = process.env.UMAMI_SCRIPT_URL?.trim();
  if (!configured) return DEFAULT_SRC;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Production reads UMAMI_WEBSITE_ID. Staging ignores it and reads UMAMI_STAGING_WEBSITE_ID. */
export function umamiScript(): { src: string; websiteId: string } | null {
  const name = isStaging() ? "UMAMI_STAGING_WEBSITE_ID" : "UMAMI_WEBSITE_ID";
  const websiteId = process.env[name]?.trim() ?? "";
  if (!WEBSITE_ID.test(websiteId)) return null;
  const src = scriptUrl();
  if (!src) return null;
  return { src, websiteId };
}
