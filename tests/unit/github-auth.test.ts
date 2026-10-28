import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";
import { github } from "better-auth/social-providers";

const db = vi.hoisted(() => ({ query: vi.fn() }));
const capture = vi.hoisted(() => ({
  options: undefined as BetterAuthOptions | undefined,
}));
vi.mock("better-auth", () => ({
  betterAuth: (options: BetterAuthOptions) => {
    capture.options = options;
    return {};
  },
}));
vi.mock("../../src/db", () => ({
  getDb: () => ({}),
  sql: vi.fn(),
  getPool: vi.fn(),
  transaction: (fn: (client: { query: typeof db.query }) => unknown) =>
    fn({ query: db.query }),
}));
import { getAuth } from "../../src/lib/auth";
import { githubToken } from "../../src/lib/github";
import { decryptToken, encryptToken } from "../../src/lib/crypto";

beforeEach(() => {
  db.query.mockReset();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-only-secret-012345678901234567890123456789",
  );
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "0".repeat(63) + "1");
  vi.stubEnv("GITHUB_CLIENT_ID", "test-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GitHub App login and refresh", () => {
  it("builds a login URL without OAuth scopes and exchanges the authorization code", async () => {
    getAuth();
    const options = capture.options!.socialProviders!.github!;
    if (typeof options === "function")
      throw new Error("Expected configured provider options");
    const provider = github(options);
    const callback = "http://localhost:3000/api/auth/callback/github";
    const url = await provider.createAuthorizationURL({
      state: "test-state",
      codeVerifier: "test-verifier",
      redirectURI: callback,
    });
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("state")).toBe("test-state");
    expect(url.searchParams.get("redirect_uri")).toBe(callback);
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "test-access",
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", request);
    const tokens = await provider.validateAuthorizationCode({
      code: "test-code",
      codeVerifier: "test-verifier",
      redirectURI: callback,
    });
    expect(tokens).toMatchObject({
      accessToken: "test-access",
      refreshToken: "test-refresh",
    });
    expect(request).toHaveBeenCalledOnce();
    const [input, init] = request.mock.calls[0];
    expect(String(input)).toBe("https://github.com/login/oauth/access_token");
    expect(String(init.body)).toContain("test-code");
  });

  it("refreshes an expiring GitHub App token and stores both rotated tokens encrypted", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "account",
            access_token: encryptToken("old-access"),
            refresh_token: encryptToken("old-refresh"),
            access_token_expires_at: new Date(0),
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
        }),
      ),
    );
    vi.stubGlobal("fetch", request);
    expect(await githubToken("owner")).toBe("new-access");
    const payload = JSON.parse(request.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: "test-client",
    });
    expect(payload).not.toHaveProperty("scope");
    const stored = db.query.mock.calls[1][1];
    expect(decryptToken(stored[1])).toBe("new-access");
    expect(decryptToken(stored[2])).toBe("new-refresh");
    expect(stored[3].getTime()).toBeGreaterThan(Date.now());
    expect(stored[4].getTime()).toBeGreaterThan(stored[3].getTime());
  });

  it("uses an unexpired token without refreshing", async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        {
          access_token: encryptToken("current-access"),
          access_token_expires_at: new Date(Date.now() + 3600000),
        },
      ],
    });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    expect(await githubToken("owner")).toBe("current-access");
    expect(request).not.toHaveBeenCalled();
  });
});
