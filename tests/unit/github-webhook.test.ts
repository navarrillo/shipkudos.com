import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; name: string; email: string } },
}));
vi.mock("next/cache", () => ({
  revalidateTag,
  unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));
vi.mock("../../src/db", () => ({
  sql,
  getPool: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("../../src/lib/auth", () => ({
  getAuth: () => ({
    handler: async () => new Response(null, { status: 404 }),
    api: { getSession: async () => session.current },
  }),
}));

import { dispatch } from "../../src/lib/api";

const secret = "test-webhook-secret";
function sign(body: string, key = secret) {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}
function webhook(body: string, event: string, signature?: string) {
  return dispatch(
    new Request("http://localhost/api/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        ...(signature === undefined
          ? {}
          : { "x-hub-signature-256": signature }),
      },
      body,
    }),
  );
}
beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue([]);
  revalidateTag.mockReset();
  session.current = null;
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  process.env.APP_URL = "http://localhost:3000";
});
describe("GitHub App revocation webhook", () => {
  it("rejects a missing or bad signature", async () => {
    const body = JSON.stringify({
      action: "revoked",
      sender: { id: 42 },
    });
    const missing = await webhook(body, "github_app_authorization");
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "invalid_signature" });
    const wrong = await webhook(
      body,
      "github_app_authorization",
      sign(body, "other-secret"),
    );
    expect(wrong.status).toBe(401);
    const short = await webhook(body, "github_app_authorization", "sha256=abc");
    expect(short.status).toBe(401);
    expect(sql).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
  it("reports that the webhook is not configured before trusting the body", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const body = JSON.stringify({ action: "revoked", sender: { id: 42 } });
    const response = await webhook(
      body,
      "github_app_authorization",
      sign(body),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_not_configured" });
    expect(sql).not.toHaveBeenCalled();
  });
  it("marks the sender for reconnect, revokes delegates and clears GitHub tokens", async () => {
    sql.mockImplementation(async (query: string) =>
      query.includes("RETURNING id") ? [{ id: "profile-1" }] : [],
    );
    const body = JSON.stringify({ action: "revoked", sender: { id: 4242 } });
    const response = await webhook(
      body,
      "github_app_authorization",
      sign(body),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const queries = sql.mock.calls.map((call) => String(call[0]));
    expect(queries[0]).toContain("sync_state='reconnect'");
    expect(queries[0]).toContain("reconnect_required");
    expect(sql.mock.calls[0][1]).toEqual(["4242"]);
    expect(queries.some((query) => query.includes("agent_credentials"))).toBe(
      true,
    );
    expect(
      queries.some((query) =>
        query.includes("DELETE FROM agent_registrations"),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.includes("access_token=NULL") &&
          query.includes("refresh_token=NULL") &&
          query.includes("id_token=NULL"),
      ),
    ).toBe(true);
    expect(sql.mock.calls.some((call) => call[1]?.[0] === "profile-1")).toBe(
      true,
    );
    expect(revalidateTag).toHaveBeenCalledWith("public-data", { expire: 0 });
  });
  it("leaves storage untouched for unrelated or incomplete events", async () => {
    const ping = await webhook("{}", "ping", sign("{}"));
    expect(ping.status).toBe(200);
    const other = await webhook(
      JSON.stringify({ action: "revoked", sender: { id: 7 } }),
      "push",
      sign(JSON.stringify({ action: "revoked", sender: { id: 7 } })),
    );
    expect(other.status).toBe(200);
    const granted = JSON.stringify({ action: "granted", sender: { id: 7 } });
    expect(
      (await webhook(granted, "github_app_authorization", sign(granted)))
        .status,
    ).toBe(200);
    const anonymous = JSON.stringify({ action: "revoked" });
    expect(
      (await webhook(anonymous, "github_app_authorization", sign(anonymous)))
        .status,
    ).toBe(200);
    const broken = "{";
    const invalid = await webhook(
      broken,
      "github_app_authorization",
      sign(broken),
    );
    expect(invalid.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
  it("does not publish a profile without explicit consent", async () => {
    const unpublished = await dispatch(
      new Request("http://localhost/api/me/publish", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ consent: true }),
      }),
    );
    expect(unpublished.status).toBe(401);
    session.current = {
      user: { id: "user-1", name: "Builder", email: "builder@example.invalid" },
    };
    for (const body of [{ consent: false }, {}, { consent: "true" }]) {
      const response = await dispatch(
        new Request("http://localhost/api/me/publish", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid_request",
        issues: [{ path: "consent", message: expect.any(String) }],
      });
    }
    expect(sql).not.toHaveBeenCalled();
  });
});
