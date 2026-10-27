import { config } from "@/lib/config";
export function GET() {
  const paths: Record<string, Record<string, unknown>> = {};
  const operations: [string, string, string, boolean][] = [
    [
      "/api/v1/agent-registrations",
      "post",
      "Start pending registration",
      false,
    ],
    [
      "/api/v1/agent-registrations/{id}",
      "get",
      "Poll using registrationToken; wait at least 5 seconds",
      true,
    ],
    [
      "/api/v1/agent-registrations/{id}/exchange",
      "post",
      "Exchange an approval once",
      true,
    ],
    ["/api/v1/me", "get", "Read profile and ranking", true],
    ["/api/v1/me/sync", "get", "Read sync status", true],
    ["/api/v1/me/sync", "post", "Request sync; one per hour per owner", true],
    [
      "/api/v1/me/share",
      "get",
      "Get public profile, suggested text and image URL",
      true,
    ],
  ];
  for (const [path, method, summary, secured] of operations) {
    const operation: Record<string, unknown> = {
      summary,
      security: secured ? [{ bearerAuth: [] }] : [],
      responses: {
        "200": { description: "Success; see /agents.md for the workflow" },
        "201": {
          description:
            "registrationId, authorizationUrl, registrationToken, expiresAt, interval",
        },
        "202": { description: "Synchronization queued" },
        "401": { description: "Invalid or revoked credential" },
        "403": { description: "Insufficient scope" },
        "409": { description: "Registration cannot be exchanged" },
        "429": {
          description: "Wait for Retry-After",
          headers: { "Retry-After": { schema: { type: "integer" } } },
        },
      },
    };
    if (path.includes("{id}"))
      operation.parameters = [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ];
    if (path.endsWith("registrations") && method === "post")
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "platform"],
              properties: {
                name: { type: "string", maxLength: 80 },
                platform: { type: "string", maxLength: 40 },
              },
            },
          },
        },
      };
    paths[path] = { ...paths[path], [method]: operation };
  }
  return Response.json({
    openapi: "3.1.0",
    info: {
      title: `${config().APP_NAME} Agent API`,
      version: "1.0.0",
      description: "Read /agents.md. Never supply a GitHub PAT.",
    },
    servers: [{ url: config().APP_URL }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    paths,
  });
}
