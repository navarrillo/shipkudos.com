import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Image from "next/image";
import { ShieldCheck, GitFork, ArrowUpRight } from "lucide-react";
import { cachedPublicProfile, shareLinks } from "@/lib/data";
import { streak } from "@/lib/domain";
import { outboundEnabled } from "@/lib/runtime";
import { explicitPeriod } from "@/lib/share";
import {
  profileCanonical,
  profileRedirectTarget,
  searchString,
} from "@/lib/seo";
import { profileSocialMetadata, withSocial } from "@/lib/social";
import { Ad } from "@/components/ad";
import { ShareProfile } from "@/components/share-profile";
export const dynamic = "force-dynamic";
function redirectMixedCase(
  login: string,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const target = profileRedirectTarget(login, searchString(searchParams));
  if (target) permanentRedirect(target);
}
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ login: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { login } = await params;
  const query = await searchParams;
  redirectMixedCase(login, query);
  const data = await cachedPublicProfile(login);
  if (!data)
    return withSocial({
      title: "Builder not found",
      alternates: { canonical: profileCanonical(login) },
    });
  return profileSocialMetadata(data, explicitPeriod(query.period));
}
export default async function Profile({
  params,
  searchParams,
}: {
  params: Promise<{ login: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { login } = await params;
  const query = await searchParams;
  redirectMixedCase(login, query);
  const data = await cachedPublicProfile(login);
  if (!data) notFound();
  const { profile, days, ranks } = data,
    weekly = ranks.find((r) => r.period === 7),
    monthly = ranks.find((r) => r.period === 30),
    current = streak(days),
    links = shareLinks(data, explicitPeriod(query.period));
  return (
    <>
      <section className="page-head">
        <div className="profile-heading">
          {profile.avatar && (
            <Image
              unoptimized
              src={profile.avatar}
              alt=""
              width={80}
              height={80}
              className="avatar"
            />
          )}
          <div>
            <div className="eyebrow mb-3">
              <ShieldCheck size={13} /> GITHUB VERIFIED
            </div>
            <h1>{profile.name}</h1>
            <p className="mono mt-3">@{profile.login}</p>
          </div>
        </div>
        {profile.bio && <p className="mt-6">{profile.bio}</p>}
        <div className="flex gap-3 flex-wrap">
          <a
            className="button button-outline"
            href={`https://github.com/${profile.login}`}
            target="_blank"
            rel="noopener"
          >
            <GitFork size={16} />
            GitHub <ArrowUpRight size={14} />
          </a>
          {outboundEnabled() ? (
            <ShareProfile
              text={links.text}
              profileUrl={links.profileUrl}
              intentUrl={links.intentUrl}
            />
          ) : null}
        </div>
      </section>
      <div className="stats">
        <div className="stat">
          <small>7-DAY ACTIVITY</small>
          <strong className="lime">
            {weekly?.score?.toLocaleString("en") ?? "—"}
          </strong>
        </div>
        <div className="stat">
          <small>7-DAY RANK</small>
          <strong>{weekly ? `#${weekly.position}` : "—"}</strong>
        </div>
        <div className="stat">
          <small>30-DAY ACTIVITY</small>
          <strong>{monthly?.score?.toLocaleString("en") ?? "—"}</strong>
        </div>
        <div className="stat">
          <small>CURRENT STREAK</small>
          <strong>
            {current.count}
            {current.capped ? "+" : ""}
            <span className="text-sm subtle ml-2">days</span>
          </strong>
        </div>
      </div>
      <div className="panel">
        <div className="eyebrow">60 DAYS OF PUBLIC PROGRESS</div>
        <div className="heatmap" aria-label="Daily activity">
          {days.map((d) => (
            <i
              key={d.day}
              title={`${d.day}: ${d.score} public contributions`}
              style={{
                background: d.score
                  ? `rgba(185,243,106,${Math.min(1, 0.25 + d.score / 30)})`
                  : undefined,
              }}
            />
          ))}
        </div>
        <p className="text-xs mt-5 mb-0">
          {days.reduce((a, d) => a + d.commits, 0)} commits ·{" "}
          {days.reduce((a, d) => a + d.prs, 0)} pull requests ·{" "}
          {days.reduce((a, d) => a + d.issues, 0)} issues ·{" "}
          {days.reduce((a, d) => a + d.reviews, 0)} reviews
        </p>
      </div>
      <div className="panel">
        <h3>Tools in the mix</h3>
        <div className="tags">
          {profile.tools.length ? (
            profile.tools.map((t) => <span key={t}>{t}</span>)
          ) : (
            <span>Not shared</span>
          )}
        </div>
        <p className="text-xs mt-4 mb-0">
          Tools are self-declared. GitHub verification confirms account
          ownership, not AI authorship.
        </p>
      </div>
      <p className="text-xs subtle">
        Last successful sync:{" "}
        {profile.last_sync_at
          ? new Date(profile.last_sync_at).toUTCString()
          : "pending"}
        .{" "}
        {!weekly &&
          "Not currently ranked: waiting for a fresh snapshot or synchronization."}
      </p>
      <Ad placement="tool" />
      <div className="mb-14" />
    </>
  );
}
