import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getAuth } from "./auth";
import { config } from "./config";
import {
  adminUser,
  bearer,
  body,
  clientKey,
  HttpError,
  json,
  rateLimit,
  route,
  sameOrigin,
  sessionUser,
} from "./http";
import { sql, getPool, transaction } from "../db";
import {
  cachedLeaderboard,
  cachedPublicProfile,
  latestRankingAt,
  ownProfile,
  shareLinks,
  toPublicLeaderboard,
  toPublicProfileView,
} from "./data";
import {
  agentOwner,
  approveRegistration,
  createRegistration,
  exchangeRegistration,
  registrationRateLimits,
  registrationSchema,
  registrationStatus,
} from "./agents";
import { enqueueSync, publishProfile, revokeDelegates } from "./queue";
import { evaluateReadiness, TOOLS, type WorkerStatus } from "./domain";
import {
  campaignSchema,
  getAdvertisement,
  placement,
  recordAdEvent,
  saveCampaign,
} from "./ads";
const uuid = z.uuid();
const invalidate = () => revalidateTag("public-data", { expire: 0 });
const isBot = (request: Request) =>
  /bot|crawler|spider|headless/i.test(request.headers.get("user-agent") || "");

export const dispatch = route(async (request: Request) => {
  const url = new URL(request.url),
    endpoint = url.pathname.replace(/^\/api\//, ""),
    method = request.method;
  if (endpoint.startsWith("auth/")) {
    const allowed = [
      "sign-in/social",
      "callback/github",
      "get-session",
      "sign-out",
      "list-accounts",
      "error",
    ];
    if (!allowed.includes(endpoint.slice(5)))
      throw new HttpError(404, "not_found");
    return getAuth().handler(request);
  }
  if (endpoint === "leaderboard" && method === "GET") {
    const period = z
        .enum(["7", "30"])
        .parse(url.searchParams.get("period") || "7"),
      q = z
        .string()
        .max(80)
        .parse(url.searchParams.get("q") || "");
    return json(
      toPublicLeaderboard(
        await cachedLeaderboard(
          Number(period),
          q,
          url.searchParams.get("cursor") || undefined,
        ),
      ),
    );
  }
  if (endpoint.startsWith("profiles/") && method === "GET") {
    const login = z
      .string()
      .regex(/^[a-z0-9-]{1,39}$/i)
      .parse(endpoint.slice(9));
    const profile = await cachedPublicProfile(login);
    if (!profile) throw new HttpError(404, "profile_not_found");
    return json(toPublicProfileView(profile));
  }
  if (endpoint === "github/webhook" && method === "POST") {
    const secret = config().GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, "webhook_not_configured");
    const text = await request.text();
    if (text.length > 65536) throw new HttpError(413, "request_too_large");
    const expected = Buffer.from(
        `sha256=${createHmac("sha256", secret).update(text).digest("hex")}`,
      ),
      actual = Buffer.from(request.headers.get("x-hub-signature-256") || "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new HttpError(401, "invalid_signature");
    const event = JSON.parse(text) as {
      action?: string;
      sender?: { id?: number };
    };
    if (
      request.headers.get("x-github-event") === "github_app_authorization" &&
      event.action === "revoked" &&
      event.sender?.id
    ) {
      const profiles = await sql(
        "UPDATE profiles SET sync_state='reconnect',sync_error='reconnect_required' WHERE github_id=$1 RETURNING id",
        [String(event.sender.id)],
      );
      for (const profile of profiles) {
        await revokeDelegates(profile.id);
        await sql(
          "UPDATE auth_account SET access_token=NULL,refresh_token=NULL,id_token=NULL WHERE user_id=$1 AND provider_id='github'",
          [profile.id],
        );
      }
      invalidate();
    }
    return json({ ok: true });
  }
  if (endpoint === "v1/agent-registrations" && method === "POST") {
    for (const rule of registrationRateLimits(clientKey(request)))
      await rateLimit(rule.key, rule.limit, rule.seconds);
    return json(
      await createRegistration(registrationSchema.parse(await body(request))),
      201,
    );
  }
  const registration = endpoint.match(
    /^v1\/agent-registrations\/([^/]+)(\/exchange)?$/,
  );
  if (registration) {
    const id = uuid.parse(registration[1]),
      token = bearer(request);
    if (method === "GET" && !registration[2])
      return json(await registrationStatus(id, token));
    if (method === "POST" && registration[2])
      return json(await exchangeRegistration(id, token));
  }
  if (endpoint.startsWith("v1/me")) {
    const scope = endpoint.endsWith("share")
      ? "share:read"
      : method === "POST"
        ? "sync:request"
        : "profile:read";
    const id = await agentOwner(request, scope);
    await rateLimit(`agent:${id}`, 120, 60);
    if (endpoint === "v1/me" && method === "GET") {
      const profile = await ownProfile(id);
      const view = await cachedPublicProfile(profile.login);
      return json(view ? toPublicProfileView(view) : null);
    }
    if (endpoint === "v1/me/sync" && method === "GET") {
      const p = await ownProfile(id);
      return json({
        state: p.sync_state,
        error: p.sync_error,
        lastSyncAt: p.last_sync_at,
        nextSyncAt: p.next_sync_at,
      });
    }
    if (endpoint === "v1/me/sync" && method === "POST") {
      await enqueueSync(id, true);
      return json({ state: "queued" }, 202);
    }
    if (endpoint === "v1/me/share" && method === "GET") {
      const p = await ownProfile(id);
      const requested = url.searchParams.get("period");
      const period = requested
        ? (Number(z.enum(["7", "30"]).parse(requested)) as 7 | 30)
        : undefined;
      const published = await cachedPublicProfile(p.login);
      return json(
        shareLinks(
          published ?? { profile: p, days: [], ranks: [] },
          period,
        ),
      );
    }
    throw new HttpError(404, "not_found");
  }
  if (endpoint.startsWith("me")) {
    const user = await sessionUser(request);
    if (method !== "GET") sameOrigin(request);
    if (endpoint === "me" && method === "GET") {
      const profile = await ownProfile(user.id);
      if (!profile) return json(profile);
      return json({
        ...profile,
        latest_ranking_at: await latestRankingAt(),
      });
    }
    if (endpoint === "me" && method === "PATCH") {
      const input = z
        .object({
          tools: z.array(z.enum(TOOLS as [string, ...string[]])).max(7),
          xHandle: z.string().regex(/^[a-zA-Z0-9_]{0,15}$/),
        })
        .parse(await body(request));
      await sql("UPDATE profiles SET tools=$2,x_handle=$3 WHERE id=$1", [
        user.id,
        input.tools,
        input.xHandle,
      ]);
      invalidate();
      return json({ ok: true });
    }
    if (endpoint === "me/publish" && method === "POST") {
      z.object({ consent: z.literal(true) }).parse(await body(request));
      await publishProfile(user.id);
      invalidate();
      return json({ state: "queued" }, 202);
    }
    if (endpoint === "me/sync" && method === "POST") {
      await enqueueSync(user.id, true);
      return json({ state: "queued" }, 202);
    }
    if (endpoint === "me/publication" && method === "DELETE") {
      await transaction(async (client) => {
        await client.query(
          "SELECT id FROM agent_registrations WHERE owner_id=$1 ORDER BY id FOR UPDATE",
          [user.id],
        );
        await client.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [
          user.id,
        ]);
        await client.query(
          "UPDATE profiles SET published_at=NULL,next_sync_at=NULL WHERE id=$1",
          [user.id],
        );
        await client.query(
          "UPDATE agent_credentials SET revoked_at=now() WHERE owner_id=$1 AND revoked_at IS NULL",
          [user.id],
        );
        await client.query(
          "DELETE FROM agent_registrations WHERE owner_id=$1",
          [user.id],
        );
      });
      invalidate();
      return json({ ok: true });
    }
    if (endpoint === "me" && method === "DELETE") {
      await sql("DELETE FROM auth_user WHERE id=$1", [user.id]);
      invalidate();
      return json({ ok: true });
    }
    if (endpoint === "me/agent-credentials" && method === "GET")
      return json(
        await sql(
          "SELECT id,name,platform,scopes,expires_at,last_used_at,revoked_at FROM agent_credentials WHERE owner_id=$1 ORDER BY created_at DESC",
          [user.id],
        ),
      );
    if (endpoint.startsWith("me/agent-credentials/") && method === "DELETE") {
      await sql(
        "UPDATE agent_credentials SET revoked_at=now() WHERE id=$1 AND owner_id=$2",
        [uuid.parse(endpoint.split("/").at(-1)), user.id],
      );
      return json({ ok: true });
    }
    if (
      /^me\/agent-registrations\/[^/]+\/approve$/.test(endpoint) &&
      method === "POST"
    ) {
      const input = z
        .object({ accepted: z.boolean() })
        .parse(await body(request));
      await approveRegistration(
        uuid.parse(endpoint.split("/")[2]),
        user.id,
        input.accepted,
      );
      invalidate();
      return json({ ok: true });
    }
  }
  if (endpoint === "advertiser-leads" && method === "POST") {
    sameOrigin(request);
    await rateLimit(`lead:${clientKey(request)}`, 3, 3600);
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.email().max(254),
        url: z.url().max(500),
        message: z.string().trim().min(10).max(3000),
        website: z.string().max(0).optional(),
      })
      .parse(await body(request));
    await sql(
      "INSERT INTO advertiser_leads(id,name,email,url,message) VALUES($1,$2,$3,$4,$5)",
      [crypto.randomUUID(), input.name, input.email, input.url, input.message],
    );
    return json({ ok: true }, 201);
  }
  if (endpoint === "ads" && method === "GET") {
    if (isBot(request)) return json(null);
    return json(
      await getAdvertisement(
        placement.parse(url.searchParams.get("placement")),
      ),
    );
  }
  if (endpoint === "ad-events" && method === "POST") {
    sameOrigin(request);
    if (isBot(request)) return json({ ok: true });
    await rateLimit(`ad:${clientKey(request)}`, 120, 60);
    const input = z
      .object({ token: z.string().max(4096) })
      .parse(await body(request));
    await recordAdEvent(input.token, "impression");
    return json({ ok: true });
  }
  if (endpoint.startsWith("media/") && method === "GET") {
    const file = z
      .string()
      .regex(/^[a-f0-9]{64}\.webp$/)
      .parse(endpoint.slice(6));
    try {
      return new Response(
        await readFile(path.join(config().UPLOADS_DIR, file)),
        {
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public,max-age=31536000,immutable",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    } catch {
      throw new HttpError(404, "not_found");
    }
  }
  if (endpoint.startsWith("admin/")) {
    const user = await adminUser(request);
    if (method !== "GET") sameOrigin(request);
    if (endpoint === "admin/overview" && method === "GET") {
      const [profiles, campaigns, advertisers, leads, metrics, jobs] =
        await Promise.all([
          sql(
            "SELECT id,login,published_at,hidden_at,sync_state,last_sync_at FROM profiles ORDER BY created_at DESC LIMIT 200",
          ),
          sql("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100"),
          sql("SELECT * FROM advertisers ORDER BY name"),
          sql(
            "SELECT * FROM advertiser_leads ORDER BY created_at DESC LIMIT 100",
          ),
          sql(
            "SELECT d.campaign_id,c.title,sum(d.impressions)::int impressions,sum(d.clicks)::int clicks FROM ad_daily d JOIN campaigns c ON c.id=d.campaign_id GROUP BY d.campaign_id,c.title",
          ),
          sql(
            "SELECT r.*,p.login FROM sync_runs r JOIN profiles p ON p.id=r.profile_id ORDER BY started_at DESC LIMIT 50",
          ),
        ]);
      return json({ profiles, campaigns, advertisers, leads, metrics, jobs });
    }
    if (endpoint === "admin/advertisers" && method === "POST") {
      const input = z
        .object({ name: z.string().trim().min(1).max(100), email: z.email() })
        .parse(await body(request));
      const id = crypto.randomUUID();
      await sql("INSERT INTO advertisers(id,name,email) VALUES($1,$2,$3)", [
        id,
        input.name,
        input.email,
      ]);
      return json({ id }, 201);
    }
    if (endpoint === "admin/campaigns" && method === "POST")
      return json(
        await saveCampaign(campaignSchema.parse(await body(request)), user.id),
      );
    if (endpoint === "admin/uploads" && method === "POST") {
      if (Number(request.headers.get("content-length") || 0) > 1100000)
        throw new HttpError(413, "image_too_large");
      const form = await request.formData(),
        file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size > 1048576 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw new HttpError(400, "invalid_image");
      const buffer = await sharp(await file.arrayBuffer(), {
        limitInputPixels: 20000000,
      })
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      const { hashSecret } = await import("./crypto");
      const name = `${hashSecret(buffer.toString("base64"))}.webp`;
      await mkdir(config().UPLOADS_DIR, { recursive: true });
      const temporary = path.join(
        config().UPLOADS_DIR,
        `.upload-${crypto.randomUUID()}`,
      );
      try {
        await writeFile(temporary, buffer, { flag: "wx" });
        // The content hash names identical bytes; readers only see complete files.
        await rename(temporary, path.join(config().UPLOADS_DIR, name));
      } finally {
        await rm(temporary, { force: true });
      }
      return json({ image: name });
    }
    if (endpoint === "admin/leads" && method === "PATCH") {
      const input = z
        .object({ id: uuid, status: z.enum(["new", "conversation", "closed"]) })
        .parse(await body(request));
      await sql("UPDATE advertiser_leads SET status=$2 WHERE id=$1", [
        input.id,
        input.status,
      ]);
      return json({ ok: true });
    }
    if (endpoint === "admin/profiles" && method === "POST") {
      const input = z
        .object({
          id: z.string().max(100),
          hidden: z.boolean(),
          reason: z.string().trim().min(3).max(500),
        })
        .parse(await body(request));
      await transaction(async (client) => {
        await client.query(
          "UPDATE profiles SET hidden_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1",
          [input.id, input.hidden],
        );
        await client.query(
          "INSERT INTO audit_log(id,actor_id,action,target_id,detail) VALUES($1,$2,$3,$4,$5)",
          [
            crypto.randomUUID(),
            user.id,
            input.hidden ? "profile_hidden" : "profile_restored",
            input.id,
            input.reason,
          ],
        );
      });
      invalidate();
      return json({ ok: true });
    }
    if (endpoint === "admin/retry" && method === "POST") {
      const input = z
        .object({ id: z.string().max(100) })
        .parse(await body(request));
      await enqueueSync(input.id);
      return json({ ok: true }, 202);
    }
    if (endpoint === "admin/metrics.csv" && method === "GET") {
      const rows = await sql(
        "SELECT campaign_id,placement,day::text,impressions,clicks FROM ad_daily ORDER BY day DESC",
      );
      const csv = [
        "campaign_id,placement,day,impressions,clicks",
        ...rows.map((r) =>
          [r.campaign_id, r.placement, r.day, r.impressions, r.clicks].join(
            ",",
          ),
        ),
      ].join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="campaign-metrics.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
  }
  throw new HttpError(404, "not_found");
});

export const ready = route(async () => {
  const env = config();
  let rows;
  try {
    const query = {
      text: "SELECT heartbeat_at,revision,oldest_runnable_at,progress_at FROM worker_health WHERE id='main'",
      query_timeout: 1000,
    };
    const result = await getPool().query<WorkerStatus>(query);
    rows = result.rows;
  } catch {
    return json(
      {
        status: "fail",
        release: env.APP_SHA,
        checks: { database: "unavailable" },
      },
      503,
    );
  }
  const status = evaluateReadiness(
    rows[0],
    env.APP_SHA,
    Date.now(),
    env.WORKER_HEARTBEAT_SECONDS,
    env.QUEUE_STALL_SECONDS,
  );
  return json(
    {
      status: status.ok ? "ok" : "fail",
      release: env.APP_SHA,
      workerRelease: rows[0]?.revision || null,
      checks: { database: "ok", worker: status.reason },
    },
    status.ok ? 200 : 503,
  );
});
