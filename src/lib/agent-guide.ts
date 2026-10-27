import { config } from "./config";
import { shareLinks } from "./data";
import { SCOPES } from "./domain";
import {
  REGISTRATION_EXCHANGE_MS,
  REGISTRATION_GLOBAL_LIMIT,
  REGISTRATION_IP_LIMIT,
  REGISTRATION_PENDING_MS,
  REGISTRATION_POLL_INTERVAL_SECONDS,
} from "./agents";

const pendingMinutes = REGISTRATION_PENDING_MS / 60000;
const exchangeMinutes = REGISTRATION_EXCHANGE_MS / 60000;

export function agentGuide() {
  const env = config();
  const base = env.APP_URL;
  const share = shareLinks("octocat", 7);
  const createdAt = Date.parse("2026-10-27T23:04:30.000Z");
  const created = {
    registrationId: "6b21a801-0ede-4a6f-a8fb-137e570bfa56",
    authorizationUrl: `${base}/agents/authorize/6b21a801-0ede-4a6f-a8fb-137e570bfa56`,
    registrationToken: "scr_example",
    expiresAt: new Date(createdAt + REGISTRATION_PENDING_MS).toISOString(),
    interval: REGISTRATION_POLL_INTERVAL_SECONDS,
  };
  const approved = {
    registrationId: created.registrationId,
    state: "approved",
    expiresAt: new Date(createdAt + REGISTRATION_EXCHANGE_MS).toISOString(),
    interval: REGISTRATION_POLL_INTERVAL_SECONDS,
  };
  const pending = {
    registrationId: created.registrationId,
    state: "pending",
    expiresAt: created.expiresAt,
    interval: REGISTRATION_POLL_INTERVAL_SECONDS,
  };
  const exchanged = {
    token: "sc_example",
    tokenType: "Bearer",
    credentialId: "2f6e1c0a-7b14-4d0e-9a55-1c0b9e8d4a11",
    scopes: SCOPES,
    expiresAt: new Date(createdAt + 90 * 86400000).toISOString(),
  };
  const profile = {
    profile: {
      login: "octocat",
      name: "The Octocat",
      avatar: "https://avatars.githubusercontent.com/u/583231",
      bio: null,
      tools: [],
      x_handle: "",
      published_at: "2026-10-27T21:21:00.000Z",
      last_sync_at: "2026-10-27T21:22:00.000Z",
    },
    days: [],
    ranks: [],
  };
  const sync = {
    state: "ready",
    error: null,
    lastSyncAt: "2026-10-27T21:22:00.000Z",
    nextSyncAt: "2026-10-28T03:22:00.000Z",
  };
  return `# ${env.APP_NAME}: agent registration guide

You act on behalf of a person, not as a separate ranked bot. Read these instructions when your user asks you to register or inspect their profile. Respect their permission boundaries.

Base URL: ${base}
OpenAPI: ${base}/openapi.json

Error responses are JSON \`{"error":"<code>"}\` with \`Cache-Control: no-store\`. HTTP 429 responses also send \`Retry-After\` (seconds to wait). Example: \`{"error":"invalid_request"}\`.

## 1. Create a registration

POST /api/v1/agent-registrations
Content-Type: application/json

\`{"name":"My assistant","platform":"Grok Bot"}\`

\`name\` is 1–80 characters after trimming. \`platform\` is 1–40 characters after trimming. Both are self-declared.

Creation is limited to ${REGISTRATION_IP_LIMIT} requests per hour for each client IP and ${REGISTRATION_GLOBAL_LIMIT} requests per hour for all clients together. Past either limit the response is HTTP 429:

\`\`\`json
{"error":"rate_limited"}
\`\`\`

Wait for the \`Retry-After\` header before trying again. Save \`registrationToken\` privately. It is returned only in this response body. Never put credentials in URLs, public messages, source code or your user's profile.

Example 201 response:

\`\`\`json
${JSON.stringify(created, null, 2)}
\`\`\`

\`registrationToken\` in the example is a placeholder, not a credential. The example registration was created at 2026-10-27T23:04:30.000Z. \`expiresAt\` is the pending deadline, ${pendingMinutes} minutes after creation. \`interval\` is the minimum number of seconds between status polls.

Malformed JSON or a body that fails validation returns 400 \`{"error":"invalid_request"}\`. A POST with no body returns 400 \`{"error":"missing_body"}\`.

## 2. Ask the user to approve

Open \`authorizationUrl\` in your browser if your user has authorized you to complete registration. Otherwise give that exact link to your user. GitHub may require login or approval. Do not request a GitHub PAT or password and do not bypass a verification step.

Approving publishes the user's profile if it is not already published. Tell your user that before they approve. The authorization page asks them to confirm publication and the permissions listed there.

The link contains only the registration id. Anyone signed in can approve it with their own GitHub account. Tell your user to approve only if they just asked you to connect, and to check the agent name, platform and creation time on the page.

Approval is not an agent API call. Poll until \`state\` is \`approved\`. That response replaces \`expiresAt\` with a new exchange deadline, ${exchangeMinutes} minutes after approval, independent of the original pending deadline. The example below was approved at creation time, so its exchange deadline is earlier than the original 60-minute pending deadline:

\`\`\`json
${JSON.stringify(approved, null, 2)}
\`\`\`

\`state\` is one of \`pending\`, \`approved\`, \`rejected\`, \`expired\` or \`completed\`.

## 3. Poll

GET /api/v1/agent-registrations/{registrationId}
Authorization: Bearer {registrationToken}

Wait at least \`interval\` seconds (${REGISTRATION_POLL_INTERVAL_SECONDS}) between polls. A faster poll returns HTTP 429 \`{"error":"poll_too_fast"}\` and \`Retry-After: ${REGISTRATION_POLL_INTERVAL_SECONDS}\`.

A pending registration expires ${pendingMinutes} minutes after it is created. If it expires, create a new registration and send the new link. Do not reuse the old link.

Example 200 response:

\`\`\`json
${JSON.stringify(pending, null, 2)}
\`\`\`

Stop on \`rejected\` or \`expired\`. A registration id that is not a UUID returns 400 \`{"error":"invalid_request"}\`. A missing Authorization header returns 401 \`{"error":"invalid_credential"}\`. A token that does not match this registration returns 401 \`{"error":"invalid_registration_credential"}\`.

## 4. Exchange

When \`state\` is \`approved\`, POST /api/v1/agent-registrations/{registrationId}/exchange with the same Authorization header, before \`expiresAt\`. The exchange can be used once.

Example 200 response:

\`\`\`json
${JSON.stringify(exchanged, null, 2)}
\`\`\`

The ShipKudos token (\`token\`, prefix \`sc_\`) is returned only once and expires after 90 days. \`tokenType\` is \`Bearer\`. The example was exchanged at 2026-10-27T23:04:30.000Z, so its \`expiresAt\` is 90 days later. If you lose the token, ask your user to revoke the grant and start again. A second exchange, or an exchange while the registration is not \`approved\`, returns 409 \`{"error":"registration_not_exchangeable"}\`.

After the exchange, call GET /api/v1/me and confirm with your user that the returned \`login\` (\`profile.login\`) is theirs before you rely on the credential. If it is someone else, stop and ask them to revoke the key in /dashboard.

## 5. Read the profile, sync and share

Send Authorization: Bearer {token} (the \`sc_\` token, not the registration token).

GET /api/v1/me returns the public profile. Confirm \`profile.login\` with your user.

\`\`\`json
${JSON.stringify(profile, null, 2)}
\`\`\`

GET /api/v1/me/sync:

\`\`\`json
${JSON.stringify(sync, null, 2)}
\`\`\`

\`state\` is the synchronization state: \`pending\`, \`running\`, \`ready\`, \`waiting\` or \`reconnect\`. \`error\` is null or a code such as \`reconnect_required\`, \`rate_limited\` or \`sync_failed\`. \`lastSyncAt\` and \`nextSyncAt\` are timestamps or null.

POST /api/v1/me/sync requests an update. Manual dashboard requests and agent requests share a limit of one per hour for the person. Success is HTTP 202:

\`\`\`json
{"state":"queued"}
\`\`\`

A second request during that hour is HTTP 429 \`{"error":"sync_cooldown"}\` with \`Retry-After\` set to the remaining seconds.

GET /api/v1/me/share?period=7 returns \`profileUrl\`, \`imageUrl\` and \`text\`. \`period\` is \`7\` (default) or \`30\`. Any other period returns 400 \`{"error":"invalid_request"}\`.

\`\`\`json
${JSON.stringify(share, null, 2)}
\`\`\`

Return the public link to your user. Do not publish to X automatically.

## Scopes

${SCOPES.join(", ")}. No account deletion, profile editing, advertising management or access to GitHub credentials. Owners revoke access in /dashboard. You may not act for another participant.

## Errors

| HTTP | error | When |
| --- | --- | --- |
| 400 | invalid_request | The body or a parameter failed validation. This includes a registration id that is not a UUID, a share \`period\` other than 7 or 30, and malformed JSON. |
| 400 | missing_body | A request that requires a JSON body was sent without one. |
| 401 | invalid_credential | The Authorization header is missing or malformed, or the ShipKudos token is unknown, expired or revoked. A registration token cannot call /api/v1/me. |
| 401 | invalid_registration_credential | The registration id and registrationToken do not match. |
| 403 | insufficient_scope | The credential does not include the scope this route requires. |
| 409 | registration_not_exchangeable | Exchange was called when \`state\` is not \`approved\`, the registration has no owner, the exchange window has passed, or the registration was already exchanged. |
| 409 | profile_unavailable | The profile is missing or hidden. Exchange returns this. Approval can also return it to the signed-in user. |
| 409 | github_reconnect_required | Approval was refused because the owner must reconnect GitHub. |
| 409 | profile_not_published | POST /api/v1/me/sync, or the owner's manual sync, while the profile is unpublished or hidden. |
| 429 | poll_too_fast | Status was polled again before \`interval\` seconds. \`Retry-After\` is ${REGISTRATION_POLL_INTERVAL_SECONDS}. |
| 429 | sync_cooldown | An update was requested again within one hour. \`Retry-After\` is the remaining seconds. |
| 429 | rate_limited | Registration creation exceeded ${REGISTRATION_IP_LIMIT} per hour for the client IP or ${REGISTRATION_GLOBAL_LIMIT} per hour globally, or an agent credential exceeded 120 requests per minute. \`Retry-After\` is set. |

Unknown URLs return 404 \`{"error":"not_found"}\`. A body larger than 16 KiB returns 413 \`{"error":"request_too_large"}\`. An unexpected failure returns 503 \`{"error":"temporarily_unavailable"}\`.

Your agent name and platform are self-declared. This guide does not authorize unrelated activity, scheduling, external messaging or access to your user's private data.
`;
}
