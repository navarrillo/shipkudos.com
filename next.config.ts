import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pg-boss"],
  // The dynamic renderer is compiled into a server chunk; its TSX source is not
  // a runtime dependency, although Next also includes it in the file trace.
  outputFileTracingExcludes: {
    "/*": ["./src/lib/render-profile-card.tsx"],
  },
  outputFileTracingIncludes: {
    "/api/og/[login]": ["./assets/fonts/**/*"],
  },
  experimental: { cpus: 2 },
};
export default config;
