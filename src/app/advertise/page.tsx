import type { Metadata } from "next";
import { LeadForm } from "@/components/lead-form";
import { advertiseMetadata } from "@/lib/seo";
import { withSocial } from "@/lib/social";
export function generateMetadata(): Metadata {
  return withSocial(advertiseMetadata());
}
export default function Advertise() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">REACH PEOPLE WHO BUILD</div>
        <h1>
          Your next users
          <br />
          are already shipping.
        </h1>
        <p>
          Put your AI product or developer tool in front of people building in
          public.
        </p>
      </div>
      <div className="grid-two pb-14">
        <div>
          <div className="panel">
            <span className="tag">PRIMARY SPONSOR</span>
            <h2 className="mt-5">A place on the board.</h2>
            <p>
              A prominent placement on the home page and leaderboard, for a
              fixed campaign period.
            </p>
          </div>
          <div className="panel">
            <span className="tag">SPONSORED TOOL</span>
            <h2 className="mt-5">Part of the toolkit.</h2>
            <p>
              A clearly marked product card alongside rankings and builder
              profiles.
            </p>
          </div>
          <p className="text-xs">
            Direct sponsorships, reviewed for audience fit. Reporting includes
            estimated impressions and clicks. Sponsorship never changes a
            builder’s rank.
          </p>
        </div>
        <LeadForm />
      </div>
    </>
  );
}
