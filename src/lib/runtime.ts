import { config } from "./config";

export function isStaging() {
  return config().APP_ENV === "staging";
}

/** Production keeps current outbound behavior. Staging no-ops unless this is set. */
export function outboundEnabled() {
  if (!isStaging()) return true;
  return /^(1|true|yes)$/i.test(process.env.STAGING_OUTBOUND?.trim() ?? "");
}

/** Third-party redirect target. Staging stays on its own origin until outbound is enabled. */
export function outboundLocation(target: string) {
  if (outboundEnabled()) return target;
  return new URL(config().APP_URL).origin;
}
