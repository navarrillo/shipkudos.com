import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => fn,
  revalidateTag: () => undefined,
}));
import { sql, getPool } from "../../src/db";
import {
  createRegistration,
  approveRegistration,
  exchangeRegistration,
  registrationStatus,
  agentOwner,
} from "../../src/lib/agents";
import { dispatch } from "../../src/lib/api";
import {
  PUBLIC_LEADERBOARD_FIELDS,
  PUBLIC_PROFILE_FIELDS,
  publicProfile,
  rebuildRankings,
  leaderboard,
} from "../../src/lib/data";
import { publicProfileMetadata } from "../../src/lib/seo";
import {
  RANK_REBUILD_AFTER_SYNC_MS,
  RANK_REBUILD_INTERVAL_MS,
  rebuildRankingsIfDue,
  recordGitHubSync,
  type RankState,
} from "../../src/lib/rankings";
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
    "INSERT INTO profiles(id,github_id,login,name,published_at,last_sync_at,sync_state) VALUES($1,$2,$3,'Integration builder',now(),now(),'ready')",
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
    const pending = await registrationStatus(r.registrationId, r.registrationToken);
    expect(pending.state).toBe("pending");
    expect(pending.authorizationUrl).toBe(r.authorizationUrl);
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
    await sql("UPDATE agent_registrations SET polled_at=NULL WHERE id=$1", [r.registrationId]);
    const completed = await registrationStatus(r.registrationId, r.registrationToken);
    expect(completed.state).toBe("completed");
    expect(completed).not.toHaveProperty("authorizationUrl");
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
    ).rejects.toMatchObject({ status: 401, code: "invalid_credential" });
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
  it("keeps a pending registration for 60 minutes and opens a fresh 10 minute exchange window", async () => {
    const r = await createRegistration({ name: "Window", platform: "HTTP" });
    const pendingLeft = new Date(r.expiresAt).getTime() - Date.now();
    expect(pendingLeft).toBeGreaterThan(59 * 60 * 1000);
    expect(pendingLeft).toBeLessThanOrEqual(60 * 60 * 1000);
    await sql(
      "UPDATE agent_registrations SET expires_at=now()+interval '20 seconds' WHERE id=$1",
      [r.registrationId],
    );
    await approveRegistration(r.registrationId, id, true);
    const [row] = await sql<{ expires_at: Date; state: string }>(
      "SELECT state,expires_at FROM agent_registrations WHERE id=$1",
      [r.registrationId],
    );
    expect(row.state).toBe("approved");
    const exchangeLeft = new Date(row.expires_at).getTime() - Date.now();
    expect(exchangeLeft).toBeGreaterThan(9 * 60 * 1000);
    expect(exchangeLeft).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);
    const status = await registrationStatus(
      r.registrationId,
      r.registrationToken,
    );
    expect(status.state).toBe("approved");
    expect(new Date(status.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 9 * 60 * 1000,
    );
    const grant = await exchangeRegistration(
      r.registrationId,
      r.registrationToken,
    );
    expect(grant.token.startsWith("sc_")).toBe(true);
    expect(grant.tokenType).toBe("Bearer");
  });
  it("rejects a second approval", async () => {
    const r = await createRegistration({ name: "Second", platform: "HTTP" });
    await approveRegistration(r.registrationId, id, true);
    await expect(
      approveRegistration(r.registrationId, id, true),
    ).rejects.toMatchObject({ status: 409, code: "registration_unavailable" });
  });
  it("rejects an exchange after the 10 minute window", async () => {
    const r = await createRegistration({ name: "Late", platform: "HTTP" });
    await approveRegistration(r.registrationId, id, true);
    await sql(
      "UPDATE agent_registrations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [r.registrationId],
    );
    await expect(
      exchangeRegistration(r.registrationId, r.registrationToken),
    ).rejects.toMatchObject({
      status: 409,
      code: "registration_not_exchangeable",
    });
  });
});
describe("public profile metadata", () => {
  it("builds a canonical profile URL from the configured base", async () => {
    await sql(
      "UPDATE profiles SET published_at=coalesce(published_at,now()), tools=ARRAY['Codex','Cursor','Grok'] WHERE id=$1",
      [id],
    );
    const data = await publicProfile(login);
    if (!data) throw new Error("published profile was not readable");
    const meta = publicProfileMetadata(data.profile, data.ranks);
    const base = new URL(process.env.APP_URL || "http://localhost:3000").href.replace(
      /\/$/,
      "",
    );
    expect(meta.alternates).toEqual({ canonical: `${base}/u/${login}` });
    expect(meta.title).toBe(
      `Integration builder (@${login}) — ships with Codex + Cursor + Grok`,
    );
    expect(meta.description).toContain("Codex, Cursor, Grok");
    expect(meta.description).toContain(`(@${login})`);
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
  it("serves allowlisted profile and leaderboard fields through the public API", async () => {
    await sql(
      `INSERT INTO daily_stats(profile_id,day,commits,prs,issues,reviews) VALUES($1,current_date,7,2,1,3)
       ON CONFLICT (profile_id,day) DO UPDATE SET commits=7,prs=2,issues=1,reviews=3`,
      [id],
    );
    await sql(
      "UPDATE profiles SET hidden_at=NULL,published_at=now(),last_sync_at=now() WHERE id=$1",
      [id],
    );
    await rebuildRankings();
    const profileResponse = await dispatch(
      new Request(`http://localhost/api/profiles/${login}`),
    );
    expect(profileResponse.status).toBe(200);
    const profile = await profileResponse.json();
    expect(Object.keys(profile).sort()).toEqual(["days", "profile", "ranks"]);
    expect(Object.keys(profile.profile)).toEqual([...PUBLIC_PROFILE_FIELDS]);
    expect(profile.profile.login).toBe(login);
    const profileJson = JSON.stringify(profile);
    expect(profileJson).not.toContain(githubId);
    expect(profileJson).not.toContain(id);
    const boardResponse = await dispatch(
      new Request(
        `http://localhost/api/leaderboard?period=7&q=${encodeURIComponent(login)}`,
      ),
    );
    expect(boardResponse.status).toBe(200);
    const board = await boardResponse.json();
    expect(Object.keys(board).sort()).toEqual([
      "entries",
      "nextCursor",
      "snapshot",
    ]);
    expect(board.entries).toHaveLength(1);
    expect(Object.keys(board.entries[0])).toEqual([
      ...PUBLIC_LEADERBOARD_FIELDS,
    ]);
    expect(board.entries[0]).toMatchObject({ login, score: 13 });
    const entriesJson = JSON.stringify(board.entries);
    expect(entriesJson).not.toContain(githubId);
    expect(entriesJson).not.toContain(id);
    expect(Object.keys(board.snapshot).sort()).toEqual(["created_at", "id"]);
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
  it("ranks a completed sync within a minute and still rebuilds every 15 minutes", async () => {
    const userId = crypto.randomUUID(),
      login = "sync-" + userId.slice(0, 8);
    const ranked = () =>
      sql<{ id: string; period: number; score: number }>(
        "SELECT s.id::text,s.period,e.score FROM ranking_entries e JOIN ranking_snapshots s ON s.id=e.snapshot_id WHERE e.profile_id=$1 ORDER BY s.period,s.created_at",
        [userId],
      );
    try {
      await sql(
        "INSERT INTO auth_user(id,name,email) VALUES($1,'Sync builder',$2)",
        [userId, userId + "@example.invalid"],
      );
      await sql(
        "INSERT INTO profiles(id,github_id,login,name,published_at,last_sync_at,sync_state) VALUES($1,$2,$3,'Sync builder',now(),now(),'ready')",
        [userId, userId, login],
      );
      await sql(
        "INSERT INTO daily_stats(profile_id,day,commits,prs,issues,reviews) VALUES($1,current_date,4,1,1,1)",
        [userId],
      );
      const lastRank = 1_700_000_000_000;
      const state: RankState = { lastRank, syncs: 0, covered: 0 };
      recordGitHubSync(state, false);
      expect(
        await rebuildRankingsIfDue(state, lastRank + RANK_REBUILD_AFTER_SYNC_MS),
      ).toBe(false);
      expect(await ranked()).toEqual([]);
      recordGitHubSync(state, true);
      expect(
        await rebuildRankingsIfDue(
          state,
          lastRank + RANK_REBUILD_AFTER_SYNC_MS - 1,
        ),
      ).toBe(false);
      expect(await ranked()).toEqual([]);
      expect(
        await rebuildRankingsIfDue(state, lastRank + RANK_REBUILD_AFTER_SYNC_MS),
      ).toBe(true);
      const first = await ranked();
      expect(first.map((row) => [row.period, row.score])).toEqual([
        [7, 7],
        [30, 7],
      ]);
      expect(state.covered).toBe(state.syncs);
      expect(state.lastRank).toBe(lastRank + RANK_REBUILD_AFTER_SYNC_MS);
      const pinned = await leaderboard(7, "", undefined, first[0].id);
      expect(pinned.snapshot?.id).toBe(first[0].id);
      expect(
        await rebuildRankingsIfDue(
          state,
          state.lastRank + RANK_REBUILD_INTERVAL_MS,
        ),
      ).toBe(false);
      expect((await ranked()).map((row) => row.id)).toEqual(
        first.map((row) => row.id),
      );
      expect(
        await rebuildRankingsIfDue(
          state,
          state.lastRank + RANK_REBUILD_INTERVAL_MS + 1,
        ),
      ).toBe(true);
      const later = await ranked();
      expect(later.map((row) => row.id)).not.toEqual(first.map((row) => row.id));
      expect(later).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ period: 7, score: 7 }),
          expect.objectContaining({ period: 30, score: 7 }),
        ]),
      );
    } finally {
      await sql("DELETE FROM auth_user WHERE id=$1", [userId]);
    }
  });
});
