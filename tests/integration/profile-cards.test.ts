import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: vi.fn(),
}));
import { dispatch } from "../../src/lib/api";
import {
  createRegistration,
  approveRegistration,
  exchangeRegistration,
} from "../../src/lib/agents";
import { generateMetadata } from "../../src/app/u/[login]/page";
import { sql, getPool } from "../../src/db";
import { getQueue, publishProfile } from "../../src/lib/queue";
import { publicProfile } from "../../src/lib/profile-data";
import {
  backfillProfileCards,
  renderProfileCards,
  storedProfileCard,
  storedShareLinks,
} from "../../src/lib/profile-cards";
import { GET } from "../../src/app/api/og/[login]/route";

const id = crypto.randomUUID();
const login = `card-${id.slice(0, 8)}`;
beforeAll(async () => {
  if (!process.env.DATABASE_URL)
    throw new Error("Requires isolated PostgreSQL");
  await sql(
    "INSERT INTO auth_user(id,name,email) VALUES($1,'Card builder',$2)",
    [id, `${id}@example.invalid`],
  );
  await sql(
    "INSERT INTO profiles(id,github_id,login,name,last_sync_at,next_sync_at,sync_state) VALUES($1,$2,$3,'Card builder',now(),now()+interval '6 hours','ready')",
    [id, `card-${id}`, login],
  );
});
afterAll(async () => {
  await sql("DELETE FROM auth_user WHERE id=$1", [id]);
  await (await getQueue()).stop();
  await getPool().end();
});
describe("persisted profile cards", () => {
  it("queues cards at publication and backfills both ready PNGs", async () => {
    await publishProfile(id);
    const [job] = await sql(
      "SELECT data FROM pgboss.job WHERE name='profile-cards' AND data->>'profileId'=$1",
      [id],
    );
    expect(job.data.profileId).toBe(id);
    const boss = await getQueue();
    expect(await backfillProfileCards(boss)).toBeGreaterThanOrEqual(1);
    await renderProfileCards(id);
    const data = (await publicProfile(login))!;
    for (const period of [7, 30] as const) {
      const links = await storedShareLinks(data, period);
      const version = new URL(links.imageUrl).searchParams.get("v");
      expect(version).toMatch(/^[a-f0-9]{32}$/);
      const stored = await storedProfileCard(login, period, version);
      const meta = await sharp(stored!.png).metadata();
      expect(meta).toMatchObject({ format: "png", width: 1200, height: 630 });
      const started = performance.now();
      const response = await GET(new Request(links.imageUrl), {
        params: Promise.resolve({ login }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer()).equals(stored!.png)).toBe(true);
      expect(performance.now() - started).toBeLessThan(300);
    }
  });
  it("shares stored versions through the agent API and profile-page metadata", async () => {
    const registration = await createRegistration({
      name: "Card test",
      platform: "HTTP",
    });
    await approveRegistration(registration.registrationId, id, true);
    const grant = await exchangeRegistration(
      registration.registrationId,
      registration.registrationToken,
    );
    const response = await dispatch(
      new Request("http://localhost/api/v1/me/share?period=30", {
        headers: { Authorization: `Bearer ${grant.token}` },
      }),
    );
    expect(response.status).toBe(200);
    const links = await response.json();
    const version = new URL(links.imageUrl).searchParams.get("v");
    expect(version).toMatch(/^[a-f0-9]{32}$/);
    expect(await storedProfileCard(login, 30, version)).toBeTruthy();
    const metadata = await generateMetadata({
      params: Promise.resolve({ login }),
      searchParams: Promise.resolve({ period: "30" }),
    });
    expect(metadata.twitter).toMatchObject({ images: [links.imageUrl] });
  });
  it("renders missing/stale versions, retains previous URLs and hides unpublished cards", async () => {
    const before = await storedProfileCard(login, 7, null);
    await sql(
      "UPDATE profiles SET name='Updated card builder',last_sync_at=now() WHERE id=$1",
      [id],
    );
    const response = await GET(
      new Request(
        `http://localhost/api/og/${login}?period=7&v=unknown-old-version`,
      ),
      { params: Promise.resolve({ login }) },
    );
    expect(response.status).toBe(200);
    const current = await storedProfileCard(login, 7, null);
    expect(current!.version).not.toBe(before!.version);
    expect(current!.png).not.toEqual(before!.png);
    expect(await storedProfileCard(login, 7, before!.version)).toBeTruthy();
    // Only two versions per period are retained, even after further updates.
    await sql("UPDATE profiles SET name='Third card builder' WHERE id=$1", [
      id,
    ]);
    await renderProfileCards(id);
    expect(await storedProfileCard(login, 7, before!.version)).toBeNull();
    const [count] = await sql(
      "SELECT count(*)::int AS total FROM profile_share_cards WHERE profile_id=$1 AND period=7",
      [id],
    );
    expect(count.total).toBe(2);
    await sql("UPDATE profiles SET published_at=NULL WHERE id=$1", [id]);
    expect(await storedProfileCard(login, 7, null)).toBeNull();
    const fallback = await GET(
      new Request(`http://localhost/api/og/${login}`),
      { params: Promise.resolve({ login }) },
    );
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("cache-control")).toBe("no-store");
  });
});
