import { test, expect } from "@playwright/test";
test("public navigation and agent instructions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your work/ })).toBeVisible();
  await page.getByRole("link", { name: "Leaderboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Meet the people/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "For agents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Your bot can take/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Read the agent guide/ }).click();
  await expect(page.locator("body")).toContainText("registrationToken");
});
test("mobile public layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("OpenAPI, health and agent enrollment boundary", async ({ request }) => {
  expect((await request.get("/healthz")).status()).toBe(200);
  const spec = await (await request.get("/openapi.json")).json();
  expect(spec.paths["/api/v1/me"]).toBeTruthy();
  if (!process.env.DATABASE_URL) return;
  const registration = await request.post("/api/v1/agent-registrations", {
    data: { name: "Browser test agent", platform: "HTTP test" },
  });
  expect(registration.status()).toBe(201);
  const data = await registration.json();
  expect(data.authorizationUrl).not.toContain(data.registrationToken);
  const status = await request.get(
    `/api/v1/agent-registrations/${data.registrationId}`,
    { headers: { Authorization: `Bearer ${data.registrationToken}` } },
  );
  expect((await status.json()).state).toBe("pending");
  const exchange = await request.post(
    `/api/v1/agent-registrations/${data.registrationId}/exchange`,
    { headers: { Authorization: `Bearer ${data.registrationToken}` } },
  );
  expect(exchange.status()).toBe(409);
});
