import { z } from "zod";
import { sql, transaction } from "../db";
import { signPayload, verifyPayload } from "./crypto";
import { HttpError } from "./http";
export const placement = z.enum(["primary", "tool"]);
export const campaignSchema = z
  .object({
    id: z.uuid().optional(),
    advertiserId: z.uuid(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240),
    url: z
      .url()
      .refine((s) => ["https:", "http:"].includes(new URL(s).protocol)),
    image: z
      .string()
      .regex(/^[a-f0-9]{64}\.webp$/)
      .nullable()
      .optional(),
    placements: z.array(placement).min(1).max(2),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    status: z.enum(["draft", "active", "paused", "ended"]),
  })
  .refine((c) => new Date(c.endsAt) > new Date(c.startsAt), {
    message: "End must follow start",
  });
export async function saveCampaign(
  value: z.infer<typeof campaignSchema>,
  actor: string,
) {
  return transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('campaign-scheduling'))",
    );
    const id = value.id || crypto.randomUUID();
    if (value.status === "active") {
      const overlap = await client.query(
        "SELECT id FROM campaigns WHERE id<>$1 AND status='active' AND placements && $2::text[] AND starts_at<$3 AND ends_at>$4 LIMIT 1",
        [id, value.placements, value.endsAt, value.startsAt],
      );
      if (overlap.rowCount) throw new HttpError(409, "placement_dates_overlap");
    }
    await client.query(
      `INSERT INTO campaigns(id,advertiser_id,title,description,url,image,placements,starts_at,ends_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(id) DO UPDATE SET advertiser_id=excluded.advertiser_id,title=excluded.title,description=excluded.description,url=excluded.url,image=excluded.image,placements=excluded.placements,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status`,
      [
        id,
        value.advertiserId,
        value.title,
        value.description,
        value.url,
        value.image || null,
        value.placements,
        value.startsAt,
        value.endsAt,
        value.status,
      ],
    );
    await client.query(
      "INSERT INTO audit_log(id,actor_id,action,target_id) VALUES($1,$2,'campaign_saved',$3)",
      [crypto.randomUUID(), actor, id],
    );
    return { id };
  });
}
type Exposure = {
  id: string;
  campaignId: string;
  placement: string;
  expires: number;
};
export async function getAdvertisement(slot: string) {
  if (!process.env.DATABASE_URL) return null;
  const [campaign] = await sql(
    "SELECT id,title,description,image FROM campaigns WHERE status='active' AND $1=ANY(placements) AND starts_at<=now() AND ends_at>now() ORDER BY starts_at LIMIT 1",
    [slot],
  );
  if (!campaign) return null;
  const token = signPayload({
    id: crypto.randomUUID(),
    campaignId: campaign.id,
    placement: slot,
    expires: Date.now() + 900000,
  });
  return {
    ...campaign,
    token,
    image: campaign.image ? `/api/media/${campaign.image}` : null,
    href: `/r/${campaign.id}?token=${encodeURIComponent(token)}`,
  };
}
export async function recordAdEvent(
  token: string,
  kind: "click" | "impression",
  expectedCampaign?: string,
) {
  const exposure = verifyPayload<Exposure>(token);
  if (
    !exposure ||
    !z.uuid().safeParse(exposure.id).success ||
    exposure.expires < Date.now() ||
    !placement.safeParse(exposure.placement).success ||
    (expectedCampaign && exposure.campaignId !== expectedCampaign)
  )
    throw new HttpError(400, "invalid_exposure");
  return transaction(async (client) => {
    const {
      rows: [campaign],
    } = await client.query("SELECT url FROM campaigns WHERE id=$1", [
      exposure.campaignId,
    ]);
    if (!campaign) throw new HttpError(404, "campaign_unavailable");
    const result = await client.query(
      "INSERT INTO ad_events(exposure_id,kind,campaign_id,placement) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING exposure_id",
      [exposure.id, kind, exposure.campaignId, exposure.placement],
    );
    if (result.rowCount)
      await client.query(
        "INSERT INTO ad_daily(campaign_id,placement,day,impressions,clicks) VALUES($1,$2,(now() AT TIME ZONE 'UTC')::date,$3,$4) ON CONFLICT(campaign_id,placement,day) DO UPDATE SET impressions=ad_daily.impressions+excluded.impressions,clicks=ad_daily.clicks+excluded.clicks",
        [
          exposure.campaignId,
          exposure.placement,
          kind === "impression" ? 1 : 0,
          kind === "click" ? 1 : 0,
        ],
      );
    return campaign.url as string;
  });
}
