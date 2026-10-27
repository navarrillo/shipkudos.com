import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, transaction } from "../db";
import { bearer, HttpError } from "./http";
import { randomSecret, hashSecret } from "./crypto";
import { config } from "./config";
import { SCOPES, type Scope } from "./domain";

export const registrationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.string().trim().min(1).max(40),
});
export async function createRegistration(
  input: z.infer<typeof registrationSchema>,
) {
  const id = randomUUID(),
    token = `scr_${randomSecret()}`,
    expires = new Date(Date.now() + 900000);
  await sql(
    "INSERT INTO agent_registrations(id,name,platform,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)",
    [id, input.name, input.platform, hashSecret(token), expires],
  );
  return {
    registrationId: id,
    authorizationUrl: `${config().APP_URL}/agents/authorize/${id}`,
    registrationToken: token,
    expiresAt: expires,
    interval: 5,
  };
}
export async function registrationStatus(id: string, token: string) {
  return transaction(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM agent_registrations WHERE id=$1 AND token_hash=$2 FOR UPDATE",
      [id, hashSecret(token)],
    );
    if (!row) throw new HttpError(401, "invalid_registration_credential");
    if (row.polled_at && Date.now() - new Date(row.polled_at).getTime() < 5000)
      throw new HttpError(429, "poll_too_fast", 5);
    const state =
      new Date(row.expires_at).getTime() <= Date.now() &&
      row.state !== "completed"
        ? "expired"
        : row.state;
    await client.query(
      "UPDATE agent_registrations SET polled_at=now(),state=$2 WHERE id=$1",
      [id, state],
    );
    return {
      registrationId: id,
      state,
      expiresAt: row.expires_at,
      interval: 5,
    };
  });
}
export async function approveRegistration(
  id: string,
  ownerId: string,
  accepted: boolean,
) {
  await transaction(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM agent_registrations WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      !row ||
      row.state !== "pending" ||
      new Date(row.expires_at).getTime() <= Date.now()
    )
      throw new HttpError(409, "registration_unavailable");
    const {
      rows: [profile],
    } = await client.query(
      "SELECT id,hidden_at,sync_state FROM profiles WHERE id=$1 FOR UPDATE",
      [ownerId],
    );
    if (!profile || profile.hidden_at)
      throw new HttpError(409, "profile_unavailable");
    if (profile.sync_state === "reconnect")
      throw new HttpError(409, "github_reconnect_required");
    await client.query(
      "UPDATE agent_registrations SET state=$2,owner_id=$3 WHERE id=$1",
      [id, accepted ? "approved" : "rejected", ownerId],
    );
    if (accepted)
      await client.query(
        "UPDATE profiles SET published_at=now(),next_sync_at=now() WHERE id=$1 AND published_at IS NULL",
        [ownerId],
      );
  });
  // Publication is part of the approval transaction; the worker's durable due-list
  // picks up first-time publications without giving additional agents extra syncs.
}
export async function exchangeRegistration(id: string, token: string) {
  return transaction(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM agent_registrations WHERE id=$1 AND token_hash=$2 FOR UPDATE",
      [id, hashSecret(token)],
    );
    if (!row) throw new HttpError(401, "invalid_registration_credential");
    if (
      row.state !== "approved" ||
      !row.owner_id ||
      new Date(row.expires_at).getTime() <= Date.now()
    )
      throw new HttpError(409, "registration_not_exchangeable");
    const {
      rows: [owner],
    } = await client.query(
      "SELECT id FROM profiles WHERE id=$1 AND published_at IS NOT NULL AND hidden_at IS NULL AND sync_state<>'reconnect' FOR UPDATE",
      [row.owner_id],
    );
    if (!owner) throw new HttpError(409, "profile_unavailable");
    const key = `sc_${randomSecret()}`,
      credentialId = randomUUID(),
      expires = new Date(Date.now() + 90 * 86400000);
    await client.query(
      "INSERT INTO agent_credentials(id,owner_id,name,platform,token_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        credentialId,
        row.owner_id,
        row.name,
        row.platform,
        hashSecret(key),
        [...SCOPES],
        expires,
      ],
    );
    await client.query(
      "UPDATE agent_registrations SET state='completed' WHERE id=$1",
      [id],
    );
    return {
      token: key,
      tokenType: "Bearer",
      credentialId,
      scopes: SCOPES,
      expiresAt: expires,
    };
  });
}
export async function agentOwner(request: Request, scope: Scope) {
  const token = bearer(request);
  const [credential] = await sql(
    `SELECT c.id,c.owner_id,c.scopes FROM agent_credentials c JOIN profiles p ON p.id=c.owner_id WHERE c.token_hash=$1 AND c.revoked_at IS NULL AND c.expires_at>now() AND p.published_at IS NOT NULL AND p.hidden_at IS NULL AND p.sync_state<>'reconnect'`,
    [hashSecret(token)],
  );
  if (!credential) throw new HttpError(401, "invalid_credential");
  if (!credential.scopes.includes(scope))
    throw new HttpError(403, "insufficient_scope");
  await sql(
    "UPDATE agent_credentials SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '5 minutes')",
    [credential.id],
  );
  return credential.owner_id as string;
}
