import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, getPool } from "../../src/db";
import { encryptToken } from "../../src/lib/crypto";
import { dayUTC, daysAgo } from "../../src/lib/domain";
import {
  agentOwner,
  approveRegistration,
  createRegistration,
  exchangeRegistration,
} from "../../src/lib/agents";
import { leaderboard, publicProfile } from "../../src/lib/data";
import { syncGitHub } from "../../src/lib/github";
import { publishProfile, getQueue } from "../../src/lib/queue";
import { rebuildRankings } from "../../src/lib/rankings";

const github = vi.hoisted(() => ({
  graphql: vi.fn(),
  getAuthenticated: vi.fn(),
}));
const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidateTag,
  unstable_cache: (fn: (...args: never[]) => unknown) => fn,
}));
vi.mock("octokit", () => ({
  Octokit: class {
    graphql = github.graphql;
    rest = { users: { getAuthenticated: github.getAuthenticated } };
  },
}));

import { dispatch } from "../../src/lib/api";

const secret = "integration-webhook-secret";
const hiddenRepo = "secret/hidden-repo-9f3c";
const hiddenEmail = "hidden-inbox-9f3c@example.invalid";
const privateCommits = 88881007;
const internalReviews = 77771007;
const restricted = 99991007;
function sign(body: string, key = secret) {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}
function repository(
  isPrivate: boolean,
  visibility: string,
  totalCount: number,
  nameWithOwner?: string,
) {
  return {
    repository: { isPrivate, visibility, nameWithOwner },
    contributions: { totalCount },
  };
}
function dayPayload(index: number) {
  const commits = 4 + index;
  const prs = 3;
  const issues = 2;
  const reviews = 1;
  return {
    restrictedContributionsCount: restricted,
    contributionCalendar: { totalContributions: restricted + 50 },
    totalCommitContributions: commits + privateCommits,
    totalPullRequestContributions: prs,
    totalIssueContributions: issues,
    totalPullRequestReviewContributions: reviews + internalReviews,
    commitContributionsByRepository: [
      repository(false, "PUBLIC", commits),
      repository(true, "PRIVATE", privateCommits, hiddenRepo),
    ],
    pullRequestContributionsByRepository: [repository(false, "PUBLIC", prs)],
    issueContributionsByRepository: [repository(false, "PUBLIC", issues)],
    pullRequestReviewContributionsByRepository: [
      repository(false, "PUBLIC", reviews),
      repository(true, "INTERNAL", internalReviews),
    ],
  };
}
async function insertUser(published: boolean) {
  const id = crypto.randomUUID();
  const githubId = String(Math.floor(Math.random() * 1_000_000_000) + 10);
  const login = "gh-" + id.slice(0, 8);
  await sql(
    "INSERT INTO auth_user(id,name,email) VALUES($1,'Launch builder',$2)",
    [id, `${id}@example.invalid`],
  );
  await sql(
    `INSERT INTO profiles(id,github_id,login,name,published_at,last_sync_at,last_full_at,sync_state)
     VALUES($1,$2,$3,'Launch builder',$4,now(),now(),'ready')`,
    [id, githubId, login, published ? new Date() : null],
  );
  await sql(
    `INSERT INTO auth_account(id,account_id,provider_id,user_id,access_token,refresh_token,id_token,access_token_expires_at)
     VALUES($1,$2,'github',$3,$4,$5,$6,now()+interval '8 hours')`,
    [
      crypto.randomUUID(),
      githubId,
      id,
      encryptToken("gho_access_secret"),
      encryptToken("ghr_refresh_secret"),
      encryptToken("github_id_token_secret"),
    ],
  );
  return { id, githubId, login };
}
async function postWebhook(
  body: string,
  event: string,
  signature: string | null,
) {
  return dispatch(
    new Request("http://localhost/api/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        ...(signature ? { "x-hub-signature-256": signature } : {}),
      },
      body,
    }),
  );
}
beforeAll(() => {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Integration tests require an isolated PostgreSQL database",
    );
  process.env.TOKEN_ENCRYPTION_KEY ??=
    "0000000000000000000000000000000000000000000000000000000000000001";
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  process.env.APP_URL ??= "http://127.0.0.1:3000";
  process.env.BETTER_AUTH_SECRET ??=
    "integration-secret-not-used-outside-test-0123456789";
});
afterAll(async () => {
  const boss = await getQueue();
  await boss.stop();
  await getPool().end();
});
describe("GitHub App revocation webhook", () => {
  it("rejects a bad signature and an unconfigured secret without changing accounts", async () => {
    const user = await insertUser(true);
    try {
      const body = JSON.stringify({
        action: "revoked",
        sender: { id: Number(user.githubId) },
      });
      const bad = await postWebhook(body, "github_app_authorization", "nope");
      expect(bad.status).toBe(401);
      const previous = process.env.GITHUB_WEBHOOK_SECRET;
      delete process.env.GITHUB_WEBHOOK_SECRET;
      try {
        const missing = await postWebhook(
          body,
          "github_app_authorization",
          sign(body),
        );
        expect(missing.status).toBe(503);
        expect(await missing.json()).toEqual({
          error: "webhook_not_configured",
        });
      } finally {
        process.env.GITHUB_WEBHOOK_SECRET = previous;
      }
      const [profile] = await sql(
        "SELECT sync_state,sync_error FROM profiles WHERE id=$1",
        [user.id],
      );
      const [account] = await sql(
        "SELECT access_token,refresh_token,id_token FROM auth_account WHERE user_id=$1",
        [user.id],
      );
      expect(profile.sync_state).toBe("ready");
      expect(profile.sync_error).toBeNull();
      expect(account.access_token).toBeTruthy();
      expect(account.refresh_token).toBeTruthy();
      expect(account.id_token).toBeTruthy();
    } finally {
      await sql("DELETE FROM auth_user WHERE id=$1", [user.id]);
    }
  });
  it("revokes only the sender's agent key and GitHub tokens", async () => {
    const sender = await insertUser(true);
    const bystander = await insertUser(true);
    try {
      const registration = await createRegistration({
        name: "Launch agent",
        platform: "HTTP",
      });
      await approveRegistration(registration.registrationId, sender.id, true);
      const grant = await exchangeRegistration(
        registration.registrationId,
        registration.registrationToken,
      );
      const other = await createRegistration({
        name: "Other agent",
        platform: "HTTP",
      });
      await approveRegistration(other.registrationId, bystander.id, true);
      const otherGrant = await exchangeRegistration(
        other.registrationId,
        other.registrationToken,
      );
      const bearer = (token: string) =>
        new Request("http://localhost", {
          headers: { Authorization: `Bearer ${token}` },
        });
      expect(await agentOwner(bearer(grant.token), "profile:read")).toBe(
        sender.id,
      );
      const noise = JSON.stringify({ zen: "design for failure" });
      expect((await postWebhook(noise, "ping", sign(noise))).status).toBe(200);
      const [stillReady] = await sql(
        "SELECT sync_state FROM profiles WHERE id=$1",
        [sender.id],
      );
      expect(stillReady.sync_state).toBe("ready");
      expect(await agentOwner(bearer(grant.token), "profile:read")).toBe(
        sender.id,
      );
      const body = JSON.stringify({
        action: "revoked",
        sender: { id: Number(sender.githubId) },
      });
      const response = await postWebhook(
        body,
        "github_app_authorization",
        sign(body),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      const [profile] = await sql(
        "SELECT sync_state,sync_error FROM profiles WHERE id=$1",
        [sender.id],
      );
      expect(profile).toEqual({
        sync_state: "reconnect",
        sync_error: "reconnect_required",
      });
      const [account] = await sql(
        "SELECT access_token,refresh_token,id_token FROM auth_account WHERE user_id=$1",
        [sender.id],
      );
      expect(account).toEqual({
        access_token: null,
        refresh_token: null,
        id_token: null,
      });
      const [credential] = await sql(
        "SELECT revoked_at FROM agent_credentials WHERE id=$1",
        [grant.credentialId],
      );
      expect(credential.revoked_at).toBeTruthy();
      const registrations = await sql(
        "SELECT id FROM agent_registrations WHERE owner_id=$1",
        [sender.id],
      );
      expect(registrations).toHaveLength(0);
      await expect(
        agentOwner(bearer(grant.token), "profile:read"),
      ).rejects.toMatchObject({ status: 401 });
      const [untouched] = await sql(
        "SELECT sync_state FROM profiles WHERE id=$1",
        [bystander.id],
      );
      const [otherAccount] = await sql(
        "SELECT access_token IS NOT NULL AS has_token FROM auth_account WHERE user_id=$1",
        [bystander.id],
      );
      expect(untouched.sync_state).toBe("ready");
      expect(otherAccount.has_token).toBe(true);
      expect(await agentOwner(bearer(otherGrant.token), "profile:read")).toBe(
        bystander.id,
      );
      expect(revalidateTag).toHaveBeenCalledWith("public-data", { expire: 0 });
    } finally {
      await sql("DELETE FROM auth_user WHERE id=$1", [sender.id]);
      await sql("DELETE FROM auth_user WHERE id=$1", [bystander.id]);
    }
  });
});
describe("public contribution sync and publication consent", () => {
  it("stores only public category totals and hides a profile before consent", async () => {
    const published = await insertUser(true);
    const unpublished = await insertUser(false);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    try {
      await sql(
        "INSERT INTO daily_stats(profile_id,day,commits,prs,issues,reviews) VALUES($1,current_date,9,1,1,1)",
        [unpublished.id],
      );
      expect(await publicProfile(unpublished.login)).toBeNull();
      const hidden = await dispatch(
        new Request(`http://localhost/api/profiles/${unpublished.login}`),
      );
      expect(hidden.status).toBe(404);
      await rebuildRankings();
      expect((await leaderboard(7, unpublished.login)).entries).toHaveLength(0);
      expect((await leaderboard(30, unpublished.login)).entries).toHaveLength(
        0,
      );
      github.graphql.mockClear();
      expect(await syncGitHub(unpublished.id)).toBe(false);
      expect(github.graphql).not.toHaveBeenCalled();
      const [untouchedStats] = await sql(
        "SELECT commits FROM daily_stats WHERE profile_id=$1",
        [unpublished.id],
      );
      expect(untouchedStats.commits).toBe(9);
      github.graphql.mockImplementation(async (query: string) => {
        expect(query).not.toContain("restrictedContributionsCount");
        expect(query).toContain("isPrivate");
        expect(query).toContain("visibility");
        expect(query).not.toContain("nameWithOwner");
        expect(query).not.toContain(hiddenRepo);
        const user: Record<string, ReturnType<typeof dayPayload>> = {};
        for (const match of query.matchAll(/\bd(\d+):/g))
          user[`d${match[1]}`] = dayPayload(Number(match[1]));
        return {
          rateLimit: {
            cost: 1,
            remaining: 4000,
            resetAt: new Date().toISOString(),
          },
          user,
        };
      });
      github.getAuthenticated.mockResolvedValue({
        data: {
          id: Number(published.githubId),
          login: published.login,
          name: "Public Name",
          avatar_url: "https://avatars.githubusercontent.com/u/1",
          bio: "public bio",
          type: "User",
          email: hiddenEmail,
        },
      });
      expect(await syncGitHub(published.id)).toBe(true);
      const days = await sql<{
        day: string;
        commits: number;
        prs: number;
        issues: number;
        reviews: number;
        score: number;
      }>(
        "SELECT day::text,commits,prs,issues,reviews,(commits+prs+issues+reviews)::int AS score FROM daily_stats WHERE profile_id=$1 ORDER BY day",
        [published.id],
      );
      expect(days).toHaveLength(7);
      let expected = 0;
      days.forEach((row, index) => {
        const offset = 6 - index;
        const commits = 4 + offset;
        expect(row.day).toBe(dayUTC(daysAgo(offset)));
        expect(row).toMatchObject({ commits, prs: 3, issues: 2, reviews: 1 });
        expect(row.score).toBe(commits + 3 + 2 + 1);
        expected += row.score;
      });
      const stored = JSON.stringify(days);
      expect(stored).not.toContain(String(privateCommits));
      expect(stored).not.toContain(String(internalReviews));
      expect(stored).not.toContain(String(restricted));
      expect(stored).not.toContain(hiddenRepo);
      const [profile] = await sql(
        "SELECT login,name,bio,sync_state FROM profiles WHERE id=$1",
        [published.id],
      );
      expect(profile).toEqual({
        login: published.login,
        name: "Public Name",
        bio: "public bio",
        sync_state: "ready",
      });
      const profileText = JSON.stringify(profile);
      expect(profileText).not.toContain(hiddenEmail);
      expect(logs.join("\n")).not.toContain(hiddenRepo);
      expect(logs.join("\n")).not.toContain(hiddenEmail);
      await rebuildRankings();
      for (const period of [7, 30]) {
        const board = await leaderboard(period, published.login);
        expect(board.entries[0].score).toBe(expected);
        expect(board.entries[0].commits + board.entries[0].prs).toBe(
          board.entries[0].score -
            board.entries[0].issues -
            board.entries[0].reviews,
        );
        expect(
          board.entries[0].commits +
            board.entries[0].prs +
            board.entries[0].issues +
            board.entries[0].reviews,
        ).toBe(board.entries[0].score);
      }
      expect(await publicProfile(unpublished.login)).toBeNull();
      await publishProfile(unpublished.id);
      const visible = await publicProfile(unpublished.login);
      expect(visible?.profile.login).toBe(unpublished.login);
      expect(visible?.days).toHaveLength(1);
      expect(visible?.days[0].score).toBe(12);
      const shown = await dispatch(
        new Request(`http://localhost/api/profiles/${unpublished.login}`),
      );
      expect(shown.status).toBe(200);
      const body = (await shown.json()) as {
        profile: { login: string };
        days: { score: number }[];
      };
      expect(body.profile.login).toBe(unpublished.login);
      expect(body.days[0].score).toBe(12);
      await sql(
        "UPDATE profiles SET published_at=NULL,next_sync_at=NULL WHERE id=$1",
        [unpublished.id],
      );
      expect(await publicProfile(unpublished.login)).toBeNull();
      expect(
        (
          await dispatch(
            new Request(`http://localhost/api/profiles/${unpublished.login}`),
          )
        ).status,
      ).toBe(404);
    } finally {
      spy.mockRestore();
      await sql("DELETE FROM auth_user WHERE id=$1", [published.id]);
      await sql("DELETE FROM auth_user WHERE id=$1", [unpublished.id]);
    }
  });
  it("keeps reconnect when revocation arrives during sync", async () => {
    const user = await insertUser(true);
    try {
      github.graphql.mockImplementation(async (query: string) => {
        const body = JSON.stringify({
          action: "revoked",
          sender: { id: Number(user.githubId) },
        });
        const response = await postWebhook(
          body,
          "github_app_authorization",
          sign(body),
        );
        expect(response.status).toBe(200);
        const days: Record<string, ReturnType<typeof dayPayload>> = {};
        for (const match of query.matchAll(/\bd(\d+):/g))
          days[`d${match[1]}`] = dayPayload(Number(match[1]));
        return {
          rateLimit: {
            cost: 1,
            remaining: 4000,
            resetAt: new Date().toISOString(),
          },
          user: days,
        };
      });
      github.getAuthenticated.mockResolvedValue({
        data: {
          id: Number(user.githubId),
          login: user.login,
          name: "Public Name",
          avatar_url: "https://avatars.githubusercontent.com/u/1",
          bio: "public bio",
          type: "User",
        },
      });
      expect(await syncGitHub(user.id)).toBe(true);
      const [profile] = await sql(
        "SELECT sync_state,sync_error FROM profiles WHERE id=$1",
        [user.id],
      );
      expect(profile).toEqual({
        sync_state: "reconnect",
        sync_error: "reconnect_required",
      });
      const [run] = await sql(
        "SELECT state FROM sync_runs WHERE profile_id=$1 ORDER BY started_at DESC",
        [user.id],
      );
      expect(run.state).toBe("completed");
    } finally {
      github.graphql.mockReset();
      github.getAuthenticated.mockReset();
      await sql("DELETE FROM auth_user WHERE id=$1", [user.id]);
    }
  });
});
