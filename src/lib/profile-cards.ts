import type { PgBoss } from "pg-boss";
import { sql } from "../db";
import { publicProfile } from "./profile-data";
import { socialImages } from "./social-image";
import { profileCardUrl, shareLinks, type ShareInput } from "./share";
import type { CardData } from "./render-profile-card";

export const PROFILE_CARDS_JOB = "profile-cards";
const visible = "p.published_at IS NOT NULL AND p.hidden_at IS NULL";

type StoredCard = { version: string; png: Buffer };
export async function storedProfileCard(
  login: string,
  period: 7 | 30,
  version: string | null,
) {
  if (!process.env.DATABASE_URL) return null;
  const [card] = await sql<StoredCard>(
    `SELECT c.version,c.png FROM profile_share_cards c JOIN profiles p ON p.id=c.profile_id
     WHERE lower(p.login)=lower($1) AND ${visible} AND c.period=$2
       AND ($3::text IS NULL OR c.version=$3)
     ORDER BY c.created_at DESC LIMIT 1`,
    [login, period, version],
  );
  return card ?? null;
}

/** Keep the current and previous image per period so in-flight share URLs stay warm. */
export async function storeProfileCard(
  data: CardData,
  period: 7 | 30,
  version: string,
  bytes: ArrayBuffer,
  createdAt: Date,
) {
  await sql(
    `INSERT INTO profile_share_cards(profile_id,period,version,png,created_at)
     SELECT id,$2,$3,$4,$5 FROM profiles WHERE id=$1 AND published_at IS NOT NULL AND hidden_at IS NULL
     ON CONFLICT(profile_id,period,version) DO NOTHING`,
    [data.profile.id, period, version, Buffer.from(bytes), createdAt],
  );
  await sql(
    `DELETE FROM profile_share_cards WHERE profile_id=$1 AND period=$2 AND version NOT IN (
       SELECT version FROM profile_share_cards WHERE profile_id=$1 AND period=$2 ORDER BY created_at DESC LIMIT 2
     )`,
    [data.profile.id, period],
  );
}

export async function renderAndStoreProfileCard(
  data: CardData,
  period: 7 | 30,
  now = new Date(),
) {
  // Import only on a miss: a stored GET never loads Satori, WASM, fonts or avatars.
  const { profileCardVersion, renderProfileCard } =
    await import("./render-profile-card");
  const version = profileCardVersion(data, period, now);
  const bytes = await socialImages.get(
    `${data.profile.id}:${period}:${version}`,
    () => renderProfileCard(data, period, now),
  );
  if (bytes) {
    try {
      await storeProfileCard(data, period, version, bytes, now);
    } catch {
      // A temporary storage failure must not discard an already-rendered PNG.
      console.error(
        JSON.stringify({
          event: "share_card_store_failed",
          profileId: data.profile.id,
          period,
        }),
      );
      return { bytes, version, stored: false };
    }
  }
  return { bytes, version, stored: Boolean(bytes) };
}

export async function renderProfileCards(profileId: string) {
  const [profile] = await sql<{ login: string }>(
    `SELECT login FROM profiles p WHERE id=$1 AND ${visible}`,
    [profileId],
  );
  if (!profile) return;
  const data = await publicProfile(profile.login);
  if (!data) return;
  const now = new Date();
  for (const period of [7, 30] as const) {
    const result = await renderAndStoreProfileCard(data, period, now);
    if (!result.stored) throw new Error("share_card_not_stored");
  }
}

export async function enqueueProfileCards(boss: PgBoss, profileId: string) {
  await boss.send(
    PROFILE_CARDS_JOB,
    { profileId },
    {
      singletonKey: profileId,
      retryLimit: 4,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300,
    },
  );
}

/** Run at startup for existing builders, and after ranking snapshots change. */
export async function backfillProfileCards(boss: PgBoss) {
  const profiles = await sql<{ id: string }>(
    `SELECT id FROM profiles p WHERE ${visible} ORDER BY id`,
  );
  for (const profile of profiles) await enqueueProfileCards(boss, profile.id);
  console.log(
    JSON.stringify({ event: "share_card_backfill", profiles: profiles.length }),
  );
  return profiles.length;
}

/** Prefer an already-stored version while a newer sync/ranking image is preparing. */
export async function storedShareLinks(data: ShareInput, period?: 7 | 30) {
  const links = shareLinks(data, period);
  let version: string | undefined;
  if (process.env.DATABASE_URL) {
    try {
      const [card] = await sql<{ version: string }>(
        `SELECT c.version FROM profile_share_cards c JOIN profiles p ON p.id=c.profile_id
         WHERE lower(p.login)=lower($1) AND ${visible} AND c.period=$2 ORDER BY c.created_at DESC LIMIT 1`,
        [data.profile.login, links.period],
      );
      version = card?.version;
    } catch {
      // During migrations/storage outages, use the unversioned on-demand route.
    }
  }
  const imageUrl = version
    ? profileCardUrl(data.profile.login, links.period, version)
    : links.imageUrl.replace(/&v=[^&]*/, "");
  return { ...links, imageUrl };
}
