import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { config } from "./config";
import { canonicalUrl, publicProfileMetadata, rootMetadata } from "./seo";
import { shareLinks, type ShareInput } from "./share";

export function absoluteUrl(pathname = "/") {
  return canonicalUrl(pathname);
}
export function defaultSocialCardPath() {
  return path.join(process.cwd(), "public", "og.png");
}

const picture = (url: string, alt: string) => ({
  url,
  width: 1200,
  height: 630,
  alt,
  type: "image/png" as const,
});

function pageTitle(metadata: Metadata) {
  const app = config().APP_NAME;
  const title = metadata.title;
  if (typeof title === "string") return `${title} · ${app}`;
  if (title && "absolute" in title && title.absolute) return title.absolute;
  if (title && "default" in title && typeof title.default === "string")
    return title.default;
  const root = rootMetadata().title;
  if (root && typeof root === "object" && "default" in root && root.default)
    return String(root.default);
  return app;
}

function pageCanonical(metadata: Metadata, fallbackPath = "/") {
  const canonical = metadata.alternates?.canonical;
  if (typeof canonical === "string") return canonical;
  if (canonical instanceof URL) return canonical.href;
  return canonicalUrl(fallbackPath);
}

/** Open Graph and Twitter tags only. Titles, descriptions, and canonicals stay in seo.ts. */
export function twitterCreator(handle: string | null | undefined) {
  const cleaned = handle?.trim().replace(/^@+/, "") ?? "";
  if (!cleaned || /[^A-Za-z0-9_]/.test(cleaned)) return undefined;
  return `@${cleaned}`;
}

export function socialPreview(
  metadata: Metadata,
  options?: {
    image?: { url: string; alt: string };
    path?: string;
    creator?: string;
  },
): Pick<Metadata, "openGraph" | "twitter"> {
  const description =
    typeof metadata.description === "string" ? metadata.description : undefined;
  const title = pageTitle(metadata);
  const url = pageCanonical(metadata, options?.path);
  const image = options?.image
    ? picture(options.image.url, options.image.alt)
    : picture(absoluteUrl("/og.png"), title);
  return {
    openGraph: {
      title,
      description,
      url,
      type: "website",
      siteName: config().APP_NAME,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image.url],
      ...(options?.creator ? { creator: options.creator } : {}),
    },
  };
}

export function withSocial(
  metadata: Metadata,
  options?: {
    image?: { url: string; alt: string };
    path?: string;
    creator?: string;
  },
): Metadata {
  return { ...metadata, ...socialPreview(metadata, options) };
}

export function profileSocialMetadata(
  data: ShareInput,
  period?: 7 | 30,
  imageUrl?: string,
): Metadata {
  const metadata = publicProfileMetadata(
    {
      name: data.profile.name,
      login: data.profile.login,
      tools: data.profile.tools,
    },
    data.ranks,
  );
  const links = shareLinks(data, period);
  const name = data.profile.name || data.profile.login;
  return withSocial(metadata, {
    image: {
      url: imageUrl ?? links.imageUrl,
      alt: `${name} (@${data.profile.login})`,
    },
    creator: twitterCreator(data.profile.x_handle),
  });
}

let defaultCard: Buffer | null = null;
export async function defaultSocialCardBytes() {
  defaultCard ??= await readFile(defaultSocialCardPath());
  return defaultCard;
}
/** A rendered profile card, or the static default when rendering is busy or fails. */
export async function socialCardResponse(
  rendered: ArrayBuffer | null | Promise<ArrayBuffer | null>,
) {
  let bytes: ArrayBuffer | null = null;
  try {
    bytes = await rendered;
  } catch {
    bytes = null;
  }
  if (bytes)
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  const fallback = await defaultSocialCardBytes();
  return new Response(new Uint8Array(fallback), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
