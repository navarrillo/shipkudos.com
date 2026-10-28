import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const db = vi.hoisted(() => ({ sql: vi.fn(), query: vi.fn() }));
vi.mock("../../src/db", () => ({
  sql: db.sql,
  getPool: vi.fn(),
  transaction: (fn: (client: { query: typeof db.query }) => unknown) =>
    fn({ query: db.query }),
}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

import { dispatch } from "../../src/lib/api";
import { route } from "../../src/lib/http";
import { agentGuide } from "../../src/lib/agent-guide";
import { agentOpenApi } from "../../src/lib/openapi";

const id = "6b21a801-0ede-4a6f-a8fb-137e570bfa56";
const base = `http://localhost/api/v1/agent-registrations/${id}`;
const headers = { authorization: "Bearer scr_test" };
beforeEach(() => {
  vi.clearAllMocks();
  db.sql.mockResolvedValue([{ hits: 1 }]);
  db.query.mockResolvedValue({ rows: [] });
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

afterEach(() => vi.unstubAllEnvs());

describe("registration credentials", () => {
  for (const method of ["GET", "POST"]) {
    for (const authorization of [
      undefined,
      "Basic wrong",
      "Bearer wrong",
      "Bearer ",
    ]) {
      it(`returns invalid_credential for ${method} with ${authorization ?? "no header"}`, async () => {
        const response = await dispatch(
          new Request(method === "GET" ? base : `${base}/exchange`, {
            method,
            headers: authorization ? { authorization } : {},
          }),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "invalid_credential" });
        expect(response.headers.get("cache-control")).toBe("no-store");
      });
    }
  }
});

describe("registration polling", () => {
  for (const state of [
    "pending",
    "approved",
    "rejected",
    "expired",
    "completed",
  ]) {
    it(`returns ${state}, with the owner URL only while pending`, async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            state,
            expires_at: new Date(Date.now() + 60_000),
            polled_at: null,
          },
        ],
      });
      const response = await dispatch(new Request(base, { headers }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.state).toBe(state);
      expect(result.registrationId).toBe(id);
      expect(result.interval).toBe(5);
      if (state === "pending")
        expect(result.authorizationUrl).toBe(
          `http://localhost:3000/agents/authorize/${id}`,
        );
      else expect(result).not.toHaveProperty("authorizationUrl");
      expect(result).not.toHaveProperty("registrationToken");
    });
  }
  it("omits the URL once a pending registration expires", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ state: "pending", expires_at: new Date(0) }],
    });
    const response = await dispatch(new Request(base, { headers }));
    expect(await response.json()).toMatchObject({ state: "expired" });
  });
  it("keeps completed polls at 200 after expiry, while a repeat exchange returns 409", async () => {
    const row = {
      state: "completed",
      expires_at: new Date(0),
      owner_id: "owner",
    };
    db.query.mockResolvedValueOnce({ rows: [row] });
    const poll = await dispatch(new Request(base, { headers }));
    expect(poll.status).toBe(200);
    expect(await poll.json()).toMatchObject({ state: "completed" });
    db.query.mockResolvedValueOnce({ rows: [row] });
    const exchange = await dispatch(
      new Request(`${base}/exchange`, { method: "POST", headers }),
    );
    expect(exchange.status).toBe(409);
    expect(await exchange.json()).toEqual({
      error: "registration_not_exchangeable",
    });
  });
  it("preserves poll throttling and Retry-After", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ polled_at: new Date() }] });
    const response = await dispatch(new Request(base, { headers }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({ error: "poll_too_fast" });
  });
});

describe("validation details", () => {
  it("identifies every invalid registration field", async () => {
    const response = await dispatch(
      new Request("http://localhost/api/v1/agent-registrations", {
        method: "POST",
        body: JSON.stringify({ name: " ", platform: "x".repeat(41) }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_request",
      issues: [
        { path: "name", message: expect.any(String) },
        { path: "platform", message: expect.any(String) },
      ],
    });
  });
  it.each([
    ["http://localhost/api/v1/agent-registrations/not-a-uuid", "id"],
    ["http://localhost/api/leaderboard?period=14", "period"],
    [`http://localhost/api/leaderboard?q=${"x".repeat(81)}`, "q"],
    ["http://localhost/api/profiles/not_valid", "login"],
  ])("identifies the invalid %s parameter", async (url, path) => {
    const response = await dispatch(new Request(url));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_request",
      issues: [{ path, message: expect.any(String) }],
    });
  });
  it("returns a stable body-level issue for malformed JSON", async () => {
    const response = await dispatch(
      new Request("http://localhost/api/v1/agent-registrations", {
        method: "POST",
        body: "{broken",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_request",
      issues: [{ path: "", message: "Malformed JSON" }],
    });
  });
  it("formats nested field paths and array indices", async () => {
    const response = await route(async () => {
      z.object({ items: z.array(z.object({ name: z.string() })) }).parse({
        items: [{ name: 3 }],
      });
      return new Response();
    })();
    expect(await response.json()).toEqual({
      error: "invalid_request",
      issues: [{ path: "items.0.name", message: expect.any(String) }],
    });
  });
  it("keeps missing_body distinct", async () => {
    const response = await dispatch(
      new Request("http://localhost/api/v1/agent-registrations", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing_body" });
  });
  it("documents the response contracts", () => {
    const guide = agentGuide();
    const spec = agentOpenApi("http://localhost:3000", "ShipKudos");
    expect(guide).not.toContain("invalid_registration_credential");
    expect(guide).toContain(
      "Polling an already-exchanged registration returns HTTP 200 `completed`",
    );
    expect(guide).toContain('"authorizationUrl"');
    expect(
      spec.components.schemas.Error.properties.issues.items.required,
    ).toEqual(["path", "message"]);
    expect(
      spec.components.schemas.RegistrationStatus.properties.authorizationUrl
        .format,
    ).toBe("uri");
    expect(JSON.stringify(spec)).not.toContain(
      "invalid_registration_credential",
    );
  });
});
