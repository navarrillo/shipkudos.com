import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, sql } from "../db";
import * as schema from "../db/schema";
import { decryptToken } from "./crypto";
import { config } from "./config";

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
function createAuth() {
  const env = config();
  if (
    !env.BETTER_AUTH_SECRET ||
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET
  )
    throw new Error("GitHub authentication is not configured");
  return betterAuth({
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    trustedOrigins: [env.APP_URL],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    account: { accountLinking: { enabled: false } },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        disableDefaultScope: true,
        scope: ["offline_access"],
        mapProfileToUser: async (profile) => {
          if (profile.type !== "User")
            throw new Error("Only personal GitHub accounts can participate");
          return {};
        },
      },
    },
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            await updateGitHubProfile(account.userId);
          },
        },
        update: {
          after: async (account) => {
            if (account.userId) await updateGitHubProfile(account.userId);
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await sql("UPDATE profiles SET last_seen_at=now() WHERE id=$1", [
              session.userId,
            ]);
          },
        },
      },
    },
    logger: {
      level: "error",
      log: () => console.error(JSON.stringify({ event: "auth_error" })),
    },
  });
}
async function updateGitHubProfile(userId: string) {
  const [account] = await sql(
    "SELECT access_token, account_id FROM auth_account WHERE user_id=$1 AND provider_id='github'",
    [userId],
  );
  if (!account?.access_token) return;
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${decryptToken(account.access_token)}`,
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("GitHub identity unavailable");
  const profile = (await response.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
    bio: string | null;
    type: string;
  };
  if (profile.type !== "User" || String(profile.id) !== account.account_id)
    throw new Error("Invalid GitHub identity");
  await sql(
    `INSERT INTO profiles(id,github_id,login,name,avatar,bio) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(id) DO UPDATE SET login=excluded.login,name=excluded.name,avatar=excluded.avatar,bio=excluded.bio,last_seen_at=now(),sync_state=CASE WHEN profiles.sync_state='reconnect' THEN 'pending' ELSE profiles.sync_state END,next_sync_at=CASE WHEN profiles.sync_state='reconnect' THEN now() ELSE profiles.next_sync_at END`,
    [
      userId,
      String(profile.id),
      profile.login,
      profile.name || profile.login,
      profile.avatar_url,
      profile.bio,
    ],
  );
}
