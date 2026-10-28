import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "../../src/db";
import {
  clientKey,
  rateLimit,
  rateLimitAddress,
  retryAfterSeconds,
  route,
} from "../../src/lib/http";
import { agentGuide } from "../../src/lib/agent-guide";
import { agentOpenApi } from "../../src/lib/openapi";
import { config } from "../../src/lib/config";
import {
  PUBLIC_LEADERBOARD_FIELDS,
  PUBLIC_PROFILE_FIELDS,
  exampleShareInput,
  shareLinks,
  toPublicLeaderboard,
  toPublicProfileView,
  type Profile,
  type RankedProfile,
} from "../../src/lib/data";
import {
  REGISTRATION_EXCHANGE_MS,
  REGISTRATION_GLOBAL_LIMIT,
  REGISTRATION_IP_LIMIT,
  REGISTRATION_PENDING_MS,
  authorizationStatusMessage,
  canExchangeRegistration,
  effectiveRegistrationState,
  exchangeExpiry,
  pendingExpiry,
  registrationRateLimits,
} from "../../src/lib/agents";

vi.mock("../../src/db", () => ({
  sql: vi.fn(),
  getPool: vi.fn(),
  transaction: vi.fn(),
}));

const secretFields = [
  "github_id",
  "hidden_at",
  "sync_state",
  "sync_error",
  "profile_id",
];

describe("registration lifetime", () => {
  it("keeps a pending registration open for 60 minutes", () => {
    const now = Date.parse("2026-10-27T22:00:00.000Z");
    expect(REGISTRATION_PENDING_MS).toBe(60 * 60 * 1000);
    expect(pendingExpiry(now).toISOString()).toBe("2026-10-27T23:00:00.000Z");
  });
  it("starts a 10 minute exchange window at approval, ignoring the pending deadline", () => {
    const created = Date.parse("2026-10-27T22:00:00.000Z");
    const pendingUntil = pendingExpiry(created);
    const approvedAt = created + 59 * 60 * 1000;
    expect(REGISTRATION_EXCHANGE_MS).toBe(10 * 60 * 1000);
    expect(exchangeExpiry(approvedAt).getTime() - approvedAt).toBe(
      REGISTRATION_EXCHANGE_MS,
    );
    const freshWindow = exchangeExpiry(approvedAt);
    expect(freshWindow.getTime()).toBeGreaterThan(pendingUntil.getTime());
    expect(
      canExchangeRegistration(
        { state: "approved", owner_id: "owner", expires_at: pendingUntil },
        pendingUntil.getTime(),
      ),
    ).toBe(false);
    expect(
      canExchangeRegistration(
        { state: "approved", owner_id: "owner", expires_at: freshWindow },
        pendingUntil.getTime(),
      ),
    ).toBe(true);
    expect(
      canExchangeRegistration(
        { state: "approved", owner_id: "owner", expires_at: freshWindow },
        approvedAt + REGISTRATION_EXCHANGE_MS - 1,
      ),
    ).toBe(true);
  });
  it("reports expired only after the active deadline, and leaves a completed registration completed", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(effectiveRegistrationState("pending", past)).toBe("expired");
    expect(effectiveRegistrationState("approved", past)).toBe("expired");
    expect(effectiveRegistrationState("approved", future)).toBe("approved");
    expect(effectiveRegistrationState("completed", past)).toBe("completed");
    expect(
      canExchangeRegistration(
        { state: "pending", owner_id: "owner", expires_at: future },
      ),
    ).toBe(false);
    expect(
      canExchangeRegistration(
        { state: "approved", owner_id: null, expires_at: future },
      ),
    ).toBe(false);
  });
  it("tells the owner to request a new link after expiry and shows the exchange deadline after approval", () => {
    const deadline = new Date("2026-10-27T23:14:30.000Z");
    expect(authorizationStatusMessage("pending", true, deadline)).toContain(
      "create a new registration and send you the new link",
    );
    expect(authorizationStatusMessage("approved", false, deadline)).toContain(
      deadline.toUTCString(),
    );
    expect(authorizationStatusMessage("approved", true, deadline)).toContain(
      "expired",
    );
  });
});

describe("registration rate limits", () => {
  it("allows 300 creations per hour per network and 10000 per hour globally", () => {
    expect(REGISTRATION_IP_LIMIT).toBe(300);
    expect(REGISTRATION_GLOBAL_LIMIT).toBe(10000);
    expect(registrationRateLimits("hashed-ip")).toEqual([
      { key: "registration:hashed-ip", limit: 300, seconds: 3600 },
      { key: "registration:global", limit: 10000, seconds: 3600 },
    ]);
  });
  it("groups IPv6 clients by their /64 prefix", () => {
    const prefix = "2001:0db8:0001:0002";
    expect(rateLimitAddress("2001:db8:1:2:3:4:5:6")).toBe(prefix);
    expect(rateLimitAddress("2001:0DB8:0001:0002::ffff")).toBe(prefix);
    expect(rateLimitAddress("2001:db8:1:2::1")).toBe(prefix);
    expect(rateLimitAddress("2001:db8:1:3::1")).toBe("2001:0db8:0001:0003");
    expect(rateLimitAddress("192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitAddress("::ffff:192.0.2.2")).toBe("192.0.2.2");
    const from = (address: string) =>
      new Request("http://localhost", {
        headers: { "x-forwarded-for": `203.0.113.5, ${address}` },
      });
    expect(clientKey(from("2001:db8:1:2::1"))).toBe(
      clientKey(from("2001:db8:1:2:abcd:ef01::9")),
    );
    expect(clientKey(from("2001:db8:1:2::1"))).not.toBe(
      clientKey(from("2001:db8:1:3::1")),
    );
    expect(clientKey(from("192.0.2.1"))).not.toBe(clientKey(from("192.0.2.2")));
  });
  it("computes Retry-After from the remaining fixed window", () => {
    expect(retryAfterSeconds(3600, 3_600_000)).toBe(3600);
    expect(retryAfterSeconds(3600, 3_605_000)).toBe(3595);
  });
  beforeEach(() => vi.mocked(sql).mockReset());
  it("returns 429 rate_limited with Retry-After once a bucket is over its limit", async () => {
    vi.mocked(sql).mockResolvedValueOnce([{ hits: 101 }]);
    const response = await route(async () => {
      await rateLimit("registration:test", 100, 3600);
      return new Response("ok");
    })();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    vi.mocked(sql).mockResolvedValueOnce([{ hits: 100 }]);
    await expect(rateLimit("registration:test", 100, 3600)).resolves.toBeUndefined();
  });
  it("returns 429 with Retry-After when the global registration bucket is exhausted", async () => {
    vi.mocked(sql)
      .mockResolvedValueOnce([{ hits: 1 }])
      .mockResolvedValueOnce([{ hits: REGISTRATION_GLOBAL_LIMIT + 1 }]);
    const response = await route(async () => {
      for (const rule of registrationRateLimits("hashed-ip"))
        await rateLimit(rule.key, rule.limit, rule.seconds);
      return new Response("ok");
    })();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    const keys = vi.mocked(sql).mock.calls.map((call) => String(call[1]?.[0]));
    expect(keys[0]).toMatch(/^registration:hashed-ip:/);
    expect(keys[1]).toMatch(/^registration:global:/);
  });
});

describe("public profile allowlist", () => {
  const profile = {
    id: "auth-user-id",
    github_id: "999001",
    login: "octocat",
    name: "The Octocat",
    avatar: "https://avatars.githubusercontent.com/u/583231",
    bio: "building",
    tools: ["Grok"],
    x_handle: "octocat",
    published_at: new Date("2026-10-27T21:21:00.000Z"),
    hidden_at: new Date("2026-10-27T21:00:00.000Z"),
    last_sync_at: new Date("2026-10-27T21:22:00.000Z"),
    sync_state: "ready",
    sync_error: "sync_failed",
    last_requested_at: new Date("2026-10-27T21:00:00.000Z"),
    next_sync_at: new Date("2026-10-27T22:00:00.000Z"),
  } satisfies Profile;
  it("returns only public profile fields", () => {
    const view = toPublicProfileView({
      profile,
      days: [
        {
          day: "2026-10-27",
          commits: 1,
          prs: 2,
          issues: 3,
          reviews: 4,
          score: 10,
        },
      ],
      ranks: [{ period: 7, position: 1, score: 10, active_days: 1 }],
    });
    expect(Object.keys(view.profile)).toEqual([...PUBLIC_PROFILE_FIELDS]);
    expect(view.profile.login).toBe("octocat");
    expect(JSON.stringify(view)).not.toContain("auth-user-id");
    expect(JSON.stringify(view)).not.toContain("999001");
    for (const field of secretFields) expect(view.profile).not.toHaveProperty(field);
    expect(view.days[0]).toEqual({
      day: "2026-10-27",
      commits: 1,
      prs: 2,
      issues: 3,
      reviews: 4,
      score: 10,
    });
    expect(Object.keys(view.ranks[0])).toEqual([
      "period",
      "position",
      "score",
      "active_days",
    ]);
  });
  it("returns only public leaderboard fields", () => {
    const entry = {
      ...profile,
      position: 1,
      score: 13,
      commits: 7,
      prs: 2,
      issues: 1,
      reviews: 3,
      active_days: 1,
      snapshot_id: "snapshot-id",
      profile_id: "auth-user-id",
    } as RankedProfile & { snapshot_id: string; profile_id: string };
    const view = toPublicLeaderboard({
      entries: [entry],
      snapshot: {
        id: "snapshot-id",
        created_at: new Date("2026-10-27T21:00:00.000Z"),
      },
      nextCursor: "signed-cursor",
    });
    expect(Object.keys(view.entries[0])).toEqual([...PUBLIC_LEADERBOARD_FIELDS]);
    expect(view.entries[0].login).toBe("octocat");
    expect(view.entries[0].score).toBe(13);
    expect(view.nextCursor).toBe("signed-cursor");
    expect(view.snapshot).toEqual({
      id: "snapshot-id",
      created_at: new Date("2026-10-27T21:00:00.000Z"),
    });
    const serialized = JSON.stringify(view.entries);
    expect(serialized).not.toContain("auth-user-id");
    expect(serialized).not.toContain("999001");
    expect(serialized).not.toContain("snapshot-id");
    for (const field of [...secretFields, "id", "snapshot_id"])
      expect(view.entries[0]).not.toHaveProperty(field);
  });
});

describe("agent documentation", () => {
  const guide = agentGuide();
  const env = config();
  const spec = agentOpenApi(env.APP_URL, env.APP_NAME);
  const schemaRef = (schema: { $ref: string }) => schema.$ref;
  it("matches the registration, share and error contract", () => {
    expect(guide).toContain("60 minutes");
    expect(guide).toContain("10 minutes");
    expect(guide).toContain(
      "If it expires, create a new registration and send the new link.",
    );
    expect(guide).toContain(
      "Approving publishes the user's profile if it is not already published.",
    );
    expect(guide).toContain("profile.login");
    expect(guide).toContain(`${REGISTRATION_IP_LIMIT} requests per hour`);
    expect(guide).toContain(`${REGISTRATION_GLOBAL_LIMIT} requests per hour`);
    expect(guide).toContain(
      new Date(
        Date.parse("2026-10-27T23:40:00.000Z") + REGISTRATION_EXCHANGE_MS,
      ).toISOString(),
    );
    expect(guide).toContain("approval time plus 10 minutes");
    expect(guide).toContain(
      "After the deadline, a `rejected` registration is reported as `expired`.",
    );
    expect(guide).toContain(
      "unpublished, hidden, or needs a GitHub reconnect",
    );
    expect(guide).toContain('{"error":"rate_limited"}');
    expect(guide).toContain("Retry-After");
    expect(guide).toContain(
      JSON.stringify(shareLinks(exampleShareInput, 7), null, 2),
    );
    for (const code of [
      "invalid_request",
      "missing_body",
      "invalid_credential",
      "registration_not_exchangeable",
      "profile_unavailable",
      "github_reconnect_required",
      "profile_not_published",
      "poll_too_fast",
      "sync_cooldown",
      "rate_limited",
    ])
      expect(guide).toContain(code);
    for (const field of [
      "profileUrl",
      "imageUrl",
      "text",
      "state",
      "approved",
      "completed",
    ])
      expect(guide).toContain(field);
    for (const field of PUBLIC_PROFILE_FIELDS) expect(guide).toContain(field);
    expect(guide).not.toContain("github_id");
    expect(guide).not.toContain("hidden_at");
  });
  it("documents a real response schema for each agent operation", () => {
    const created = spec.paths["/api/v1/agent-registrations"].post.responses;
    const status = spec.paths["/api/v1/agent-registrations/{id}"].get.responses;
    const exchange =
      spec.paths["/api/v1/agent-registrations/{id}/exchange"].post.responses;
    const profile = spec.paths["/api/v1/me"].get.responses;
    const sync = spec.paths["/api/v1/me/sync"];
    const share = spec.paths["/api/v1/me/share"].get.responses;
    expect(schemaRef(created["201"].content["application/json"].schema)).toBe(
      "#/components/schemas/RegistrationCreated",
    );
    expect("200" in created).toBe(false);
    expect(created["400"].description).toContain("invalid_request");
    expect(created["429"].headers?.["Retry-After"]).toBeTruthy();
    expect(schemaRef(status["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/RegistrationStatus",
    );
    expect(
      spec.components.schemas.RegistrationStatus.properties.state.enum,
    ).toEqual(["pending", "approved", "rejected", "expired", "completed"]);
    expect(status["400"].description).toContain("invalid_request");
    expect(status["401"].description).toContain("invalid_credential");
    expect(status["429"].headers?.["Retry-After"]).toBeTruthy();
    expect("404" in status).toBe(false);
    expect(schemaRef(exchange["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/ExchangeResult",
    );
    expect(spec.components.schemas.ExchangeResult.required).toEqual([
      "token",
      "tokenType",
      "credentialId",
      "scopes",
      "expiresAt",
    ]);
    expect(exchange["409"].description).toContain(
      "registration_not_exchangeable",
    );
    expect("429" in exchange).toBe(false);
    expect(schemaRef(profile["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/PublicProfile",
    );
    expect(schemaRef(sync.get.responses["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/SyncStatus",
    );
    expect(
      schemaRef(sync.post.responses["202"].content["application/json"].schema),
    ).toBe("#/components/schemas/SyncQueued");
    expect(sync.post.responses["409"].description).toContain(
      "profile_not_published",
    );
    expect(sync.post.responses["429"].headers?.["Retry-After"]).toBeTruthy();
    expect(schemaRef(share["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/ShareLinks",
    );
    expect(spec.components.schemas.ShareLinks.required).toEqual([
      "profileUrl",
      "imageUrl",
      "text",
      "intentUrl",
      "period",
    ]);
    expect(spec.components.schemas.ShareLinks.example).toEqual(
      shareLinks(exampleShareInput, 7),
    );
    expect(spec.components.schemas.Error.required).toEqual(["error"]);
    expect(spec.components.schemas.PublicProfile.properties.profile.required).toEqual(
      [...PUBLIC_PROFILE_FIELDS],
    );
    const publicProfile = spec.paths["/api/profiles/{login}"].get.responses;
    const board = spec.paths["/api/leaderboard"].get.responses;
    expect(schemaRef(publicProfile["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/PublicProfile",
    );
    expect(publicProfile["400"].description).toContain("invalid_request");
    expect(publicProfile["404"].description).toContain("profile_not_found");
    expect(schemaRef(board["200"].content["application/json"].schema)).toBe(
      "#/components/schemas/PublicLeaderboard",
    );
    expect(board["400"].description).toContain("invalid_request");
    expect(board["409"].description).toContain(
      "ranking_updated_restart_pagination",
    );
    expect(
      spec.components.schemas.PublicLeaderboard.properties.entries.items.required,
    ).toEqual([...PUBLIC_LEADERBOARD_FIELDS]);
  });
});
