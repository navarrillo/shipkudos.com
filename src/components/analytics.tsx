import { umamiScript } from "@/lib/umami";

export function Analytics() {
  const script = umamiScript();
  if (!script) return null;
  return (
    <script defer src={script.src} data-website-id={script.websiteId} />
  );
}
