import { isIPv6 } from "node:net";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAuth } from "./auth";
import { config } from "./config";
import { hashSecret } from "./crypto";
import { sql } from "../db";
import { HttpError } from "./errors";
export { HttpError } from "./errors";

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
function ipv6Groups(address: string) {
  let text = address;
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const numbers = text
      .slice(lastColon + 1)
      .split(".")
      .map((part) => Number(part));
    if (
      numbers.length !== 4 ||
      numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    )
      return null;
    const hi = ((numbers[0] << 8) | numbers[1]).toString(16);
    const lo = ((numbers[2] << 8) | numbers[3]).toString(16);
    text = `${text.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part
      ? part.split(":").map((group) => Number.parseInt(group, 16))
      : [];
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const groups = [...head, ...tail];
  if (groups.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff))
    return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}
/** IPv4 stays as written. IPv6 shares one bucket per /64. IPv4-mapped addresses use the embedded IPv4 address. */
export function rateLimitAddress(address: string) {
  const trimmed = address.trim();
  const candidate = trimmed.replace(/^\[|\]$/g, "").split("%")[0];
  if (!isIPv6(candidate)) return trimmed;
  const groups = ipv6Groups(candidate);
  if (!groups) return trimmed;
  const mapped = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  if (mapped) {
    const hi = groups[6],
      lo = groups[7];
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return groups
    .slice(0, 4)
    .map((part) => part.toString(16).padStart(4, "0"))
    .join(":");
}
export function clientKey(request: Request) {
  const address = rateLimitAddress(
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      "local",
  );
  return hashSecret(
    `${address}:${config().BETTER_AUTH_SECRET || "development"}`,
  );
}
export function retryAfterSeconds(windowSeconds: number, now = Date.now()) {
  return windowSeconds - (Math.floor(now / 1000) % windowSeconds);
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const [row] = await sql(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits`,
    [`${key}:${bucket}`, seconds],
  );
  if (row.hits > limit)
    throw new HttpError(429, "rate_limited", retryAfterSeconds(seconds));
}
