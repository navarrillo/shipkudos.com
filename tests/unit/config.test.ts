import { afterEach, describe, expect, it } from "vitest";
import { requireProductionConfig } from "../../src/lib/config";

const keys = [
  "NODE_ENV",
  "APP_ENV",
  "APP_URL",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_WEBHOOK_SECRET",
] as const;
const previous = new Map(keys.map((key) => [key, process.env[key]]));
const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://shipkudos:secret@postgres/shipkudos",
  BETTER_AUTH_SECRET: "integration-secret-not-used-outside-test-0123456789",
  TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  GITHUB_CLIENT_ID: "id",
  GITHUB_CLIENT_SECRET: "secret",
  GITHUB_WEBHOOK_SECRET: "hook",
};

const env = process.env as Record<string, string | undefined>;
function withEnv(values: Record<string, string | undefined>) {
  for (const key of keys) delete env[key];
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) env[key] = value;
}

afterEach(() => {
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe("production APP_URL", () => {
  it("refuses to start when APP_URL is missing", () => {
    withEnv(production);
    expect(() => requireProductionConfig()).toThrow(
      "Missing environment variable: APP_URL",
    );
  });

  it("refuses loopback hosts", () => {
    for (const APP_URL of [
      "http://localhost:3000",
      "https://localhost",
      "http://127.0.0.1:3000",
      "https://127.0.0.1:3000",
    ]) {
      withEnv({ ...production, APP_URL });
      expect(() => requireProductionConfig()).toThrow(/loopback host/);
    }
  });

  it("still requires HTTPS for a public host", () => {
    withEnv({ ...production, APP_URL: "http://shipkudos.com" });
    expect(() => requireProductionConfig()).toThrow(
      "Production APP_URL must use HTTPS",
    );
  });

  it("accepts a public https URL and keeps the local default outside production", () => {
    withEnv({ ...production, APP_URL: "https://shipkudos.com" });
    expect(requireProductionConfig().APP_URL).toBe("https://shipkudos.com");
    expect(requireProductionConfig().APP_ENV).toBe("production");
    withEnv({ ...production, NODE_ENV: "development" });
    expect(requireProductionConfig().APP_URL).toBe("http://localhost:3000");
  });

  it("treats a blank APP_ENV as production and accepts a staging host", () => {
    withEnv({ ...production, APP_ENV: "", APP_URL: "https://shipkudos.com" });
    expect(requireProductionConfig().APP_ENV).toBe("production");
    withEnv({
      ...production,
      APP_ENV: "staging",
      APP_URL: "https://staging.shipkudos.com",
    });
    expect(requireProductionConfig().APP_ENV).toBe("staging");
    expect(requireProductionConfig().APP_URL).toBe(
      "https://staging.shipkudos.com",
    );
  });

  it("refuses the production host when APP_ENV is staging", () => {
    for (const APP_URL of [
      "https://shipkudos.com",
      "https://www.shipkudos.com",
    ]) {
      withEnv({ ...production, APP_ENV: "staging", APP_URL });
      expect(() => requireProductionConfig()).toThrow(/production host/);
    }
  });
});
