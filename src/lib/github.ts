import { Octokit } from "octokit";
import { getPool, sql, transaction } from "../db";
import { decryptToken, encryptToken } from "./crypto";
import { daysAgo, dayUTC, publicCounters, type Counts } from "./domain";
import { revokeDelegates } from "./queue";

export class GitHubDeferred extends Error {
  constructor(public seconds: number) {
    super("github_rate_limited");
  }
}
let nextRequest = 0;
async function pace() {
  const delay = Math.max(0, nextRequest - Date.now());
  nextRequest = Math.max(Date.now(), nextRequest) + 500;
  if (delay) await new Promise((r) => setTimeout(r, delay));
}
export async function githubToken(id: string) {
  return transaction(async (client) => {
    const {
      rows: [account],
    } = await client.query(
      "SELECT * FROM auth_account WHERE user_id=$1 AND provider_id='github' FOR UPDATE",
      [id],
    );
    if (!account?.access_token) throw new Error("github_reconnect_required");
    if (
      account.access_token_expires_at &&
      new Date(account.access_token_expires_at).getTime() < Date.now() + 60000
    ) {
      if (!account.refresh_token) throw new Error("github_reconnect_required");
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: decryptToken(account.refresh_token),
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      const tokens = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        refresh_token_expires_in?: number;
      };
      if (response.status === 429)
        throw new GitHubDeferred(
          Math.max(60, Number(response.headers.get("retry-after")) || 60),
        );
      if (response.status >= 500)
        throw new Error("github_temporarily_unavailable");
      if (!response.ok || !tokens.access_token || !tokens.refresh_token)
        throw new Error("github_reconnect_required");
      await client.query(
        "UPDATE auth_account SET access_token=$2,refresh_token=$3,access_token_expires_at=$4,refresh_token_expires_at=$5,updated_at=now() WHERE id=$1",
        [
          account.id,
          encryptToken(tokens.access_token),
          encryptToken(tokens.refresh_token),
          new Date(Date.now() + (tokens.expires_in || 28800) * 1000),
          new Date(
            Date.now() + (tokens.refresh_token_expires_in || 15897600) * 1000,
          ),
        ],
      );
      return tokens.access_token;
    }
    return decryptToken(account.access_token);
  });
}
export async function syncGitHub(profileId: string) {
  const [profile] = await sql(
    "SELECT * FROM profiles WHERE id=$1 AND published_at IS NOT NULL AND hidden_at IS NULL",
    [profileId],
  );
  if (!profile) return;
  const run = crypto.randomUUID();
  await sql(
    "INSERT INTO sync_runs(id,profile_id,state) VALUES($1,$2,'running')",
    [run, profileId],
  );
  await sql(
    "UPDATE profiles SET sync_state='running',sync_error=NULL WHERE id=$1",
    [profileId],
  );
  try {
    const token = await githubToken(profileId);
    const octokit = new Octokit({
      auth: token,
      throttle: { enabled: false },
      retry: { enabled: false },
      request: { signal: AbortSignal.timeout(120000) },
    });
    const full =
      !profile.last_sync_at ||
      !profile.last_full_at ||
      new Date(profile.last_full_at).getTime() < Date.now() - 7 * 86400000;
    const rows: ({ day: string } & Counts)[] = [];
    for (let offset = 0; offset < (full ? 60 : 7); offset += 10) {
      const fields: string[] = [];
      const dates: string[] = [];
      for (
        let index = offset;
        index < Math.min(offset + 10, full ? 60 : 7);
        index++
      ) {
        const from = daysAgo(index),
          to = new Date(from.getTime() + 86400000 - 1000);
        dates.push(dayUTC(from));
        fields.push(
          `d${index}: contributionsCollection(from:"${from.toISOString()}",to:"${to.toISOString()}"){totalCommitContributions totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions}`,
        );
      }
      await pace();
      const result = await octokit.graphql<{
        rateLimit: { cost: number; remaining: number; resetAt: string };
        user: Record<
          string,
          {
            totalCommitContributions: number;
            totalPullRequestContributions: number;
            totalIssueContributions: number;
            totalPullRequestReviewContributions: number;
          }
        >;
      }>(
        `query($login:String!){rateLimit{cost remaining resetAt} user(login:$login){${fields.join("\n")}}}`,
        {
          login: profile.login,
        },
      );
      if (!result.user) throw new Error("github_profile_unavailable");
      console.log(
        JSON.stringify({
          event: "github_query",
          cost: result.rateLimit.cost,
          remaining: result.rateLimit.remaining,
          resetAt: result.rateLimit.resetAt,
        }),
      );
      dates.forEach((day, index) => {
        const d = result.user[`d${offset + index}`];
        if (!d) throw new Error("github_partial_response");
        rows.push({ day, ...publicCounters(d) });
      });
    }
    await pace();
    const { data: identity } = await octokit.rest.users.getAuthenticated();
    if (String(identity.id) !== profile.github_id || identity.type !== "User")
      throw new Error("github_identity_mismatch");
    await transaction(async (client) => {
      const {
        rows: [stillPublished],
      } = await client.query(
        "SELECT id FROM profiles WHERE id=$1 AND published_at IS NOT NULL AND hidden_at IS NULL FOR UPDATE",
        [profileId],
      );
      if (!stillPublished) return;
      for (const row of rows)
        await client.query(
          "INSERT INTO daily_stats(profile_id,day,commits,prs,issues,reviews) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(profile_id,day) DO UPDATE SET commits=excluded.commits,prs=excluded.prs,issues=excluded.issues,reviews=excluded.reviews",
          [profileId, row.day, row.commits, row.prs, row.issues, row.reviews],
        );
      const active =
        rows.some((r) => r.commits + r.prs + r.issues + r.reviews > 0) ||
        new Date(profile.last_seen_at).getTime() > Date.now() - 7 * 86400000;
      await client.query(
        "UPDATE profiles SET login=$2,name=$3,avatar=$4,bio=$5,sync_state='ready',sync_error=NULL,last_sync_at=now(),last_full_at=CASE WHEN $6 THEN now() ELSE last_full_at END,next_sync_at=now()+$7*interval '1 hour' WHERE id=$1",
        [
          profileId,
          identity.login,
          identity.name || identity.login,
          identity.avatar_url,
          identity.bio,
          full,
          active ? 6 : 24,
        ],
      );
      await client.query(
        "UPDATE sync_runs SET state='completed',finished_at=now() WHERE id=$1",
        [run],
      );
    });
  } catch (error) {
    const e = error as {
      status?: number;
      response?: { headers?: Record<string, string> };
      headers?: Record<string, string>;
      errors?: { type?: string }[];
      message?: string;
    };
    const headers = e.response?.headers || e.headers || {};
    const limited =
      error instanceof GitHubDeferred ||
      e.errors?.some((item) => item.type === "RATE_LIMITED") ||
      headers["x-ratelimit-remaining"] === "0" ||
      e.status === 429 ||
      (e.status === 403 &&
        (headers["retry-after"] || headers["x-ratelimit-remaining"] === "0"));
    const seconds = limited
      ? Math.max(
          60,
          (error instanceof GitHubDeferred ? error.seconds : 0) ||
            Number(headers["retry-after"]) ||
            Number(headers["x-ratelimit-reset"]) -
              Math.floor(Date.now() / 1000) ||
            60,
        )
      : 60;
    const reconnect =
      e.status === 401 || e.message === "github_reconnect_required";
    const code = reconnect
      ? "reconnect_required"
      : limited
        ? "rate_limited"
        : "sync_failed";
    await sql(
      "UPDATE sync_runs SET state='failed',finished_at=now(),error_code=$2 WHERE id=$1",
      [run, code],
    );
    await sql(
      "UPDATE profiles SET sync_state=$2,sync_error=$3,next_sync_at=now()+$4*interval '1 second' WHERE id=$1",
      [profileId, reconnect ? "reconnect" : "waiting", code, seconds],
    );
    if (reconnect) {
      await revokeDelegates(profileId);
      return;
    }
    if (!limited) throw new Error(code);
  }
}
export const closeDatabase = () => getPool().end();
