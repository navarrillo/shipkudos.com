import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { sql, getPool } from "../../src/db";
import {
  createRegistration,
  approveRegistration,
  exchangeRegistration,
  registrationStatus,
  agentOwner,
} from "../../src/lib/agents";
import { rebuildRankings, leaderboard } from "../../src/lib/data";
import { getQueue } from "../../src/lib/queue";
import {
  saveCampaign,
  getAdvertisement,
  recordAdEvent,
} from "../../src/lib/ads";
const id = crypto.randomUUID(),
  githubId = String(Math.floor(Math.random() * 10000000) + 9000000),
  login = "test-" + id.slice(0, 8);
beforeAll(async () => {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Integration tests require an isolated PostgreSQL database",
    );
  await sql(
    "INSERT INTO auth_user(id,name,email) VALUES($1,'Integration builder',$2)",
    [id, id + "@example.invalid"],
  );
  await sql(
    "INSERT INTO profiles(id,github_id,login,name,last_sync_at) VALUES($1,$2,$3,'Integration builder',now())",
    [id, githubId, login],
  );
});
afterAll(async () => {
  await sql("DELETE FROM auth_user WHERE id=$1", [id]);
  const boss = await getQueue();
  await boss.stop();
  await getPool().end();
});
describe("agent enrollment", () => {
  it("requires approval, issues one scoped credential and revokes immediately", async () => {
    const r = await createRegistration({
      name: "Integration agent",
      platform: "HTTP",
    });
    expect(r.authorizationUrl).not.toContain(r.registrationToken);
    expect(
      (await registrationStatus(r.registrationId, r.registrationToken)).state,
    ).toBe("pending");
    await expect(
      exchangeRegistration(r.registrationId, r.registrationToken),
    ).rejects.toMatchObject({ status: 409 });
    await approveRegistration(r.registrationId, id, true);
    const grant = await exchangeRegistration(
      r.registrationId,
      r.registrationToken,
    );
    expect(
      await agentOwner(
        new Request("http://localhost", {
          headers: { Authorization: `Bearer ${grant.token}` },
        }),
        "profile:read",
      ),
    ).toBe(id);
    await expect(
      exchangeRegistration(r.registrationId, r.registrationToken),
    ).rejects.toMatchObject({ status: 409 });
    const [stored] = await sql(
      "SELECT token_hash FROM agent_credentials WHERE id=$1",
      [grant.credentialId],
    );
    expect(stored.token_hash).not.toContain(grant.token);
    await sql("UPDATE agent_credentials SET revoked_at=now() WHERE id=$1", [
      grant.credentialId,
    ]);
    await expect(
      agentOwner(
        new Request("http://localhost", {
          headers: { Authorization: `Bearer ${grant.token}` },
        }),
        "profile:read",
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("rejects expired registrations and isolates registration secrets", async () => {
    const a = await createRegistration({ name: "A", platform: "HTTP" }),
      b = await createRegistration({ name: "B", platform: "HTTP" });
    await expect(
      registrationStatus(a.registrationId, b.registrationToken),
    ).rejects.toMatchObject({ status: 401 });
    await sql(
      "UPDATE agent_registrations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [a.registrationId],
    );
    expect(
      (await registrationStatus(a.registrationId, a.registrationToken)).state,
    ).toBe("expired");
    await expect(
      approveRegistration(a.registrationId, id, true),
    ).rejects.toMatchObject({ status: 409 });
  });
});
describe("ranking and campaign integrity", () => {
  it("publishes consistent sums from daily public counters", async () => {
    await sql(
      "INSERT INTO daily_stats(profile_id,day,commits,prs,issues,reviews) VALUES($1,current_date,7,2,1,3)",
      [id],
    );
    await rebuildRankings();
    const board = await leaderboard(7, login);
    expect(board.entries[0].score).toBe(13);
    expect(board.entries[0].active_days).toBe(1);
    await sql("UPDATE profiles SET hidden_at=now() WHERE id=$1", [id]);
    expect((await leaderboard(7, login)).entries).toHaveLength(0);
    await sql("UPDATE profiles SET hidden_at=NULL WHERE id=$1", [id]);
  });
  it("rejects overlapping placements and deduplicates measurements", async () => {
    const advertiser = crypto.randomUUID();
    await sql(
      "INSERT INTO advertisers(id,name,email) VALUES($1,'Test sponsor','test@example.invalid')",
      [advertiser],
    );
    const value = {
      advertiserId: advertiser,
      title: "Test tool",
      description: "A test sponsorship",
      url: "https://example.com",
      placements: ["primary" as const],
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      status: "active" as const,
    };
    const campaign = await saveCampaign(value, id);
    await expect(
      saveCampaign({ ...value, title: "Overlap" }, id),
    ).rejects.toMatchObject({ status: 409 });
    const ad = await getAdvertisement("primary");
    expect(ad).toBeTruthy();
    await recordAdEvent(ad!.token, "impression");
    await recordAdEvent(ad!.token, "impression");
    const [metric] = await sql(
      "SELECT impressions FROM ad_daily WHERE campaign_id=$1",
      [campaign.id],
    );
    expect(metric.impressions).toBe(1);
    await sql("DELETE FROM ad_events WHERE campaign_id=$1", [campaign.id]);
    await sql("DELETE FROM ad_daily WHERE campaign_id=$1", [campaign.id]);
    await sql("DELETE FROM campaigns WHERE id=$1", [campaign.id]);
    await sql("DELETE FROM advertisers WHERE id=$1", [advertiser]);
  });
});
