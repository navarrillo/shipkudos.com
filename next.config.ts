import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pg-boss"],
  outputFileTracingIncludes: {
    "/api/og/[login]": ["./src/assets/fonts/**/*"],
  },
  experimental: { cpus: 2 },
};
export default config;
