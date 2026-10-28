import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ENV: z.enum(["production", "staging"]).default("production"),
  APP_NAME: z.string().default("ShipKudos"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_GITHUB_IDS: z.string().default(""),
  APP_SHA: z.string().default("development"),
  UPLOADS_DIR: z.string().default("./uploads"),
  WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().min(30).default(120),
  QUEUE_STALL_SECONDS: z.coerce.number().int().min(60).default(600),
});
const PRODUCTION_HOSTS = new Set(["shipkudos.com", "www.shipkudos.com"]);
export const config = () => {
  const appEnv = process.env.APP_ENV?.trim();
  const env = schema.parse({
    ...process.env,
    APP_ENV: appEnv ? appEnv : undefined,
  });
  if (env.APP_ENV === "staging") {
    const host = new URL(env.APP_URL).hostname;
    if (PRODUCTION_HOSTS.has(host))
      throw new Error("Staging APP_URL must not use the production host");
  }
  return env;
};
export function requireProductionConfig() {
  const env = config();
  for (const name of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_WEBHOOK_SECRET",
  ] as const) {
    if (!env[name]) throw new Error(`Missing environment variable: ${name}`);
  }
  if (env.NODE_ENV === "production") {
    if (!process.env.APP_URL)
      throw new Error("Missing environment variable: APP_URL");
    const url = new URL(env.APP_URL);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      throw new Error(
        "Production APP_URL must not use a loopback host (localhost or 127.0.0.1)",
      );
    if (url.protocol !== "https:")
      throw new Error("Production APP_URL must use HTTPS");
  }
  if (
    env.BETTER_AUTH_SECRET!.length < 32 ||
    !/^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY!)
  )
    throw new Error("Invalid application key configuration");
  return env;
}
