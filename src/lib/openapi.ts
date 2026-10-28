import { SCOPES } from "./domain";
import {
  PUBLIC_LEADERBOARD_FIELDS,
  PUBLIC_PROFILE_FIELDS,
  exampleShareInput,
  shareLinks,
} from "./data";
import {
  REGISTRATION_EXCHANGE_MS,
  REGISTRATION_GLOBAL_LIMIT,
  REGISTRATION_GLOBAL_WINDOW_SECONDS,
  REGISTRATION_IP_LIMIT,
  REGISTRATION_IP_WINDOW_SECONDS,
  REGISTRATION_PENDING_MS,
  REGISTRATION_POLL_INTERVAL_SECONDS,
} from "./agents";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string, description: string) => ({
  description,
  content: { "application/json": { schema: ref(name) } },
});
const failure = (description: string, retryAfter = false) => ({
  description,
  ...(retryAfter
    ? {
        headers: {
          "Retry-After": {
            description: "Seconds to wait before retrying",
            schema: { type: "integer", minimum: 1 },
          },
        },
      }
    : {}),
  content: { "application/json": { schema: ref("Error") } },
});

const profileProperties: Record<
  (typeof PUBLIC_PROFILE_FIELDS)[number],
  Record<string, unknown>
> = {
  login: { type: "string", description: "GitHub login. Confirm this with the user." },
  name: { type: "string" },
  avatar: { type: ["string", "null"] },
  bio: { type: ["string", "null"] },
  tools: { type: "array", items: { type: "string" } },
  x_handle: { type: "string" },
  published_at: { type: ["string", "null"], format: "date-time" },
  last_sync_at: { type: ["string", "null"], format: "date-time" },
};
const leaderboardProperties: Record<
  (typeof PUBLIC_LEADERBOARD_FIELDS)[number],
  Record<string, unknown>
> = {
  login: { type: "string" },
  name: { type: "string" },
  avatar: { type: ["string", "null"] },
  tools: { type: "array", items: { type: "string" } },
  last_sync_at: { type: ["string", "null"], format: "date-time" },
  position: { type: "integer" },
  score: { type: "integer" },
  commits: { type: "integer" },
  prs: { type: "integer" },
  issues: { type: "integer" },
  reviews: { type: "integer" },
  active_days: { type: "integer" },
};

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

export function agentOpenApi(appUrl: string, appName: string) {
  const share = shareLinks(exampleShareInput, 7);
  const pendingMinutes = REGISTRATION_PENDING_MS / 60000;
  const exchangeMinutes = REGISTRATION_EXCHANGE_MS / 60000;
  return {
    openapi: "3.1.0",
    info: {
      title: `${appName} Agent API`,
      version: "1.0.0",
      description:
        "Read /agents.md. Hand authorizationUrl to the owner in chat or terminal output; the agent cannot open the owner's browser or use their signed-in session. Poll in a background process and exchange immediately on approval within 10 minutes. Call GET /api/v1/me immediately after exchange to learn which GitHub account approved. Store the sc_ key outside chat/model context in a 0600 file or secret store; never print it. Never supply a GitHub PAT. Error bodies are {\"error\":\"<code>\"}.",
    },
    servers: [{ url: appUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Error: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: {
            error: {
              type: "string",
              description:
                "Machine-readable code. See /agents.md for the codes each operation returns.",
            },
          },
        },
        RegistrationCreated: {
          type: "object",
          additionalProperties: false,
          required: [
            "registrationId",
            "authorizationUrl",
            "registrationToken",
            "expiresAt",
            "interval",
          ],
          properties: {
            registrationId: { type: "string", format: "uuid" },
            authorizationUrl: { type: "string", format: "uri" },
            registrationToken: {
              type: "string",
              description:
                "Temporary polling credential, prefix scr_. Returned once in this body only.",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: `Pending deadline, ${pendingMinutes} minutes after creation.`,
            },
            interval: {
              type: "integer",
              const: REGISTRATION_POLL_INTERVAL_SECONDS,
            },
          },
        },
        RegistrationStatus: {
          type: "object",
          additionalProperties: false,
          required: ["registrationId", "state", "expiresAt", "interval"],
          properties: {
            registrationId: { type: "string", format: "uuid" },
            state: {
              type: "string",
              enum: [
                "pending",
                "approved",
                "rejected",
                "expired",
                "completed",
              ],
              description:
                "After the deadline, pending, approved and rejected are reported as expired. completed stays completed.",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: `While pending, ${pendingMinutes} minutes after creation. While approved, ${exchangeMinutes} minutes after approval.`,
            },
            interval: {
              type: "integer",
              const: REGISTRATION_POLL_INTERVAL_SECONDS,
            },
          },
        },
        ExchangeResult: {
          type: "object",
          additionalProperties: false,
          required: [
            "token",
            "tokenType",
            "credentialId",
            "scopes",
            "expiresAt",
          ],
          properties: {
            token: {
              type: "string",
              description: "ShipKudos credential, prefix sc_. Returned once.",
            },
            tokenType: { type: "string", const: "Bearer" },
            credentialId: { type: "string", format: "uuid" },
            scopes: {
              type: "array",
              items: { type: "string", enum: [...SCOPES] },
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: "Credential expiry, 90 days after the exchange.",
            },
          },
        },
        SyncStatus: {
          type: "object",
          additionalProperties: false,
          required: ["state", "error", "lastSyncAt", "nextSyncAt"],
          properties: {
            state: {
              type: "string",
              enum: ["pending", "running", "ready", "waiting", "reconnect"],
            },
            error: { type: ["string", "null"] },
            lastSyncAt: { type: ["string", "null"], format: "date-time" },
            nextSyncAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        SyncQueued: {
          type: "object",
          additionalProperties: false,
          required: ["state"],
          properties: { state: { type: "string", const: "queued" } },
        },
        ShareLinks: {
          type: "object",
          additionalProperties: false,
          required: ["profileUrl", "imageUrl", "text", "intentUrl", "period"],
          properties: {
            profileUrl: { type: "string", format: "uri" },
            imageUrl: { type: "string", format: "uri" },
            text: { type: "string" },
            intentUrl: { type: "string", format: "uri" },
            period: { type: "integer", enum: [7, 30] },
          },
          example: share,
        },
        PublicProfile: {
          type: "object",
          additionalProperties: false,
          required: ["profile", "days", "ranks"],
          properties: {
            profile: {
              type: "object",
              additionalProperties: false,
              required: [...PUBLIC_PROFILE_FIELDS],
              properties: profileProperties,
            },
            days: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["day", "commits", "prs", "issues", "reviews", "score"],
                properties: {
                  day: { type: "string" },
                  commits: { type: "integer" },
                  prs: { type: "integer" },
                  issues: { type: "integer" },
                  reviews: { type: "integer" },
                  score: { type: "integer" },
                },
              },
            },
            ranks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["period", "position", "score", "active_days"],
                properties: {
                  period: { type: "integer", enum: [7, 30] },
                  position: { type: "integer" },
                  score: { type: "integer" },
                  active_days: { type: "integer" },
                },
              },
            },
          },
        },
        PublicLeaderboard: {
          type: "object",
          additionalProperties: false,
          required: ["entries", "snapshot", "nextCursor"],
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [...PUBLIC_LEADERBOARD_FIELDS],
                properties: leaderboardProperties,
              },
            },
            snapshot: {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["id", "created_at"],
              properties: {
                id: { type: "string", format: "uuid" },
                created_at: { type: "string", format: "date-time" },
              },
            },
            nextCursor: { type: ["string", "null"] },
          },
        },
      },
    },
    paths: {
      "/api/v1/agent-registrations": {
        post: operation(
          "Start a pending registration",
          false,
          {
            "201": json(
              "RegistrationCreated",
              `Registration created. Pending for ${pendingMinutes} minutes.`,
            ),
            "400": failure(
              "invalid_request when the JSON is malformed or fails validation. missing_body when the body is absent.",
            ),
            "429": failure(
              `rate_limited. More than ${REGISTRATION_IP_LIMIT} creations in ${REGISTRATION_IP_WINDOW_SECONDS} seconds for one IPv4 address or one IPv6 /64, or more than ${REGISTRATION_GLOBAL_LIMIT} in ${REGISTRATION_GLOBAL_WINDOW_SECONDS} seconds for all clients.`,
              true,
            ),
          },
          {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["name", "platform"],
                    properties: {
                      name: { type: "string", minLength: 1, maxLength: 80 },
                      platform: { type: "string", minLength: 1, maxLength: 40 },
                    },
                  },
                },
              },
            },
          },
        ),
      },
      "/api/v1/agent-registrations/{id}": {
        get: operation(
          "Poll using registrationToken; wait at least 5 seconds",
          true,
          {
            "200": json(
              "RegistrationStatus",
              "Current registration state. expiresAt is the pending deadline, or the exchange deadline after approval.",
            ),
            "400": failure(
              "invalid_request. The registration id is not a UUID.",
            ),
            "401": failure(
              "invalid_credential when Authorization is missing or malformed, or invalid_registration_credential when the token does not match this registration.",
            ),
            "429": failure(
              `poll_too_fast. Polled again before ${REGISTRATION_POLL_INTERVAL_SECONDS} seconds.`,
              true,
            ),
          },
          { parameters: [idParameter] },
        ),
      },
      "/api/v1/agent-registrations/{id}/exchange": {
        post: operation(
          "Exchange an approval once",
          true,
          {
            "200": json(
              "ExchangeResult",
              "ShipKudos token. Returned once. Expires 90 days after this call.",
            ),
            "400": failure(
              "invalid_request. The registration id is not a UUID.",
            ),
            "401": failure(
              "invalid_credential when Authorization is missing or malformed, or invalid_registration_credential when the token does not match this registration.",
            ),
            "409": failure(
              "registration_not_exchangeable when the registration is not approved, has no owner, the exchange window has passed, or it was already exchanged. profile_unavailable when the profile is missing or hidden.",
            ),
          },
          { parameters: [idParameter] },
        ),
      },
      "/api/v1/me": {
        get: operation(
          "Read the public profile and ranking",
          true,
          {
            "200": json(
              "PublicProfile",
              "Public profile fields only. Confirm profile.login with the user.",
            ),
            "401": failure(
              "invalid_credential. Missing, unknown, expired or revoked token, or the profile is unpublished, hidden or needs a GitHub reconnect.",
            ),
            "403": failure("insufficient_scope. The token lacks profile:read."),
            "429": failure(
              "rate_limited. More than 120 requests in 60 seconds for this owner.",
              true,
            ),
          },
        ),
      },
      "/api/v1/me/sync": {
        get: operation("Read sync status", true, {
          "200": json("SyncStatus", "Synchronization state for this profile."),
          "401": failure("invalid_credential."),
          "403": failure("insufficient_scope. The token lacks profile:read."),
          "429": failure(
            "rate_limited. More than 120 requests in 60 seconds for this owner.",
            true,
          ),
        }),
        post: operation("Request sync; one per hour per owner", true, {
          "202": json("SyncQueued", "Synchronization queued."),
          "401": failure("invalid_credential."),
          "403": failure("insufficient_scope. The token lacks sync:request."),
          "409": failure(
            "profile_not_published. The profile is unpublished or hidden.",
          ),
          "429": failure(
            "sync_cooldown when an update was already requested within the last hour for this profile, regardless of credential (a second agent for the same owner inherits it), or rate_limited when the owner exceeded 120 requests in 60 seconds.",
            true,
          ),
        }),
      },
      "/api/leaderboard": {
        get: operation(
          "Read the public leaderboard",
          false,
          {
            "200": json(
              "PublicLeaderboard",
              "Participating builders. Entries contain only public fields.",
            ),
            "400": failure(
              "invalid_request. period is not 7 or 30, or q is longer than 80 characters.",
            ),
            "409": failure(
              "ranking_updated_restart_pagination. The cursor does not match this period, search, or snapshot. Start again without a cursor.",
            ),
          },
          {
            parameters: [
              {
                name: "period",
                in: "query",
                required: false,
                schema: { type: "string", enum: ["7", "30"], default: "7" },
              },
              {
                name: "q",
                in: "query",
                required: false,
                schema: { type: "string", maxLength: 80, default: "" },
              },
              {
                name: "cursor",
                in: "query",
                required: false,
                schema: { type: "string" },
              },
            ],
          },
        ),
      },
      "/api/profiles/{login}": {
        get: operation(
          "Read one public profile",
          false,
          {
            "200": json(
              "PublicProfile",
              "Public profile fields only.",
            ),
            "400": failure(
              "invalid_request. login is not 1–39 letters, digits or hyphens.",
            ),
            "404": failure("profile_not_found. No published visible profile has this login."),
          },
          {
            parameters: [
              {
                name: "login",
                in: "path",
                required: true,
                schema: { type: "string", pattern: "^[A-Za-z0-9-]{1,39}$" },
              },
            ],
          },
        ),
      },
      "/api/v1/me/share": {
        get: operation(
          "Get profileUrl, imageUrl, suggested text and the X intent",
          true,
          {
            "200": json(
              "ShareLinks",
              "Public profile URL, share-card image URL and suggested text.",
            ),
            "400": failure(
              "invalid_request. period is present and is not 7 or 30.",
            ),
            "401": failure("invalid_credential."),
            "403": failure("insufficient_scope. The token lacks share:read."),
            "429": failure(
              "rate_limited. More than 120 requests in 60 seconds for this owner.",
              true,
            ),
          },
          {
            parameters: [
              {
                name: "period",
                in: "query",
                required: false,
                schema: { type: "string", enum: ["7", "30"], default: "7" },
              },
            ],
          },
        ),
      },
    },
  };
}

function operation<R extends Record<string, object>, E extends object = object>(
  summary: string,
  secured: boolean,
  responses: R,
  extra?: E,
) {
  return {
    summary,
    security: secured ? [{ bearerAuth: [] }] : [],
    ...extra,
    responses,
  } as { summary: string; security: { bearerAuth: string[] }[]; responses: R } & E;
}
