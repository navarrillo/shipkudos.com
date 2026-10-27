import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAuth } from "./auth";
import { config } from "./config";
import { hashSecret } from "./crypto";
import { sql } from "../db";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
export function route<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>,
) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof HttpError)
        return NextResponse.json(
          { error: error.code },
          {
            status: error.status,
            headers: {
              "Cache-Control": "no-store",
              ...(error.retryAfter
                ? { "Retry-After": String(error.retryAfter) }
                : {}),
            },
          },
        );
      if (error instanceof ZodError || error instanceof SyntaxError)
        return json({ error: "invalid_request" }, 400);
      console.error(
        JSON.stringify({
          event: "request_error",
          type: error instanceof Error ? error.name : "unknown",
        }),
      );
      return json({ error: "temporarily_unavailable" }, 503);
    }
  };
}
export async function body(request: Request, maxBytes = 16384) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new HttpError(413, "request_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "missing_body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "request_too_large");
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(config().APP_URL).origin)
    throw new HttpError(403, "invalid_origin");
}
export async function sessionUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "sign_in_required");
  return session.user;
}
export async function adminUser(request: Request) {
  const user = await sessionUser(request);
  const [profile] = await sql("SELECT github_id FROM profiles WHERE id=$1", [
    user.id,
  ]);
  if (
    !profile ||
    !config()
      .ADMIN_GITHUB_IDS.split(",")
      .map((x) => x.trim())
      .includes(profile.github_id)
  )
    throw new HttpError(403, "admin_required");
  return user;
}
export function bearer(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ") || value.length > 512)
    throw new HttpError(401, "invalid_credential");
  return value.slice(7);
}
export function clientKey(request: Request) {
  return hashSecret(
    (request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "local") +
      ":" +
      (config().BETTER_AUTH_SECRET || "development"),
  );
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const [row] = await sql(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits`,
    [`${key}:${bucket}`, seconds],
  );
  if (row.hits > limit)
    throw new HttpError(
      429,
      "rate_limited",
      seconds - (Math.floor(Date.now() / 1000) % seconds),
    );
}
