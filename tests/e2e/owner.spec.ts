import { test, expect } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
test.describe("verified owner and delegated agent", () => {
  test.skip(
    !process.env.DATABASE_URL,
    "Requires an isolated PostgreSQL database",
  );
  const id = randomUUID(),
    token = randomUUID(),
    login = "owner-" + id.slice(0, 8);
  let pool: pg.Pool;
  test.beforeAll(async () => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      "INSERT INTO auth_user(id,name,email,email_verified) VALUES($1,'Owner test',$2,true)",
      [id, id + "@example.invalid"],
    );
    await pool.query(
      "INSERT INTO profiles(id,github_id,login,name) VALUES($1,$2,$3,'Owner test')",
      [id, "8" + Date.now(), login],
    );
    await pool.query(
      "INSERT INTO auth_session(id,token,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [randomUUID(), token, id],
    );
  });
  test.afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM auth_user WHERE id=$1", [id]);
      await pool.end();
    }
  });
  test("agent starts, owner confirms through the browser, key reads only its owner", async ({
    page,
    context,
    request,
  }) => {
    const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
      .update(token)
      .digest("base64");
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(`${token}.${signature}`),
        url: "http://127.0.0.1:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const registration = await (
      await request.post("/api/v1/agent-registrations", {
        data: { name: "Acceptance agent", platform: "HTTP test" },
      })
    ).json();
    await page.goto(`/agents/authorize/${registration.registrationId}`);
    await expect(page.getByText(`@${login}`, { exact: true })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Approve agent" }).click();
    await expect(page.getByRole("status")).toContainText("Approved");
    const auth = { Authorization: `Bearer ${registration.registrationToken}` };
    const exchange = await request.post(
      `/api/v1/agent-registrations/${registration.registrationId}/exchange`,
      { headers: auth },
    );
    expect(exchange.status()).toBe(200);
    const key = await exchange.json();
    const profile = await request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(profile.status()).toBe(200);
    expect((await profile.json()).profile.login).toBe(login);
    const image = await request.get(`/api/og/${login}`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    expect(
      (
        await request.delete("/api/me", {
          headers: { Authorization: `Bearer ${key.token}` },
        })
      ).status(),
    ).toBe(401);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: `@${login}`, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("revoked");
    expect(
      (
        await request.get("/api/v1/me", {
          headers: { Authorization: `Bearer ${key.token}` },
        })
      ).status(),
    ).toBe(401);
  });
});
