import { config } from "./config";

export function isStaging() {
  return config().APP_ENV === "staging";
}

/** Production always allows server-sent redirects. Staging holds them unless this is set. */
export function outboundEnabled() {
  if (!isStaging()) return true;
  return /^(1|true|yes)$/i.test(process.env.STAGING_OUTBOUND?.trim() ?? "");
}

/** Advertiser click target. Staging stays on its own origin until outbound is enabled. */
export function outboundLocation(target: string) {
  if (outboundEnabled()) return target;
  return new URL(config().APP_URL).origin;
}
