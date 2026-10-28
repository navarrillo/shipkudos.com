import { config } from "@/lib/config";
import { isStaging } from "@/lib/runtime";

export function StagingMark() {
  if (!isStaging()) return null;
  const host = new URL(config().APP_URL).host;
  return (
    <p className="staging-banner">
      Staging <span className="staging-banner-host">{host}</span>
    </p>
  );
}
