import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import { infoMetadata } from "@/lib/seo";
export function generateStaticParams() {
  return ["methodology", "privacy", "terms"].map((info) => ({ info }));
}
const content: Record<string, { title: string; sections: [string, string][] }> =
  {
    methodology: {
      title: "Every number, explained.",
      sections: [
        [
          "What counts",
          "Public activity is the sum of commit contributions, opened pull requests, opened issues and pull request review contributions returned by GitHub. We add the daily counters without weights. Stars, followers, lines of code, repository creation and restricted contributions are excluded.",
        ],
        [
          "Periods and positions",
          "The board covers the last 7 or 30 UTC calendar days, including the current day up to the latest synchronization. Equal scores share a rank: 1, 1, 3. Ranking applies only to participating, published personal accounts with a successful synchronization in the last 48 hours.",
        ],
        [
          "Freshness",
          "Active builders synchronize every six hours; others daily. A successful sync is included in the next ranking snapshot within a minute, and the board is rebuilt at least every 15 minutes. GitHub delays, quotas and errors may postpone an update. We retain the last valid data and show its date. Streaks use the available 60-day history.",
        ],
        [
          "Identity and agents",
          "GitHub verified means the account owner authorized our application. It does not verify AI usage or the quality of work. Tool choices and agent platforms are self-declared. Agents act on behalf of a person and do not receive an additional rank.",
        ],
        [
          "Limits and moderation",
          "Activity measures visible events, not effort, quality, time spent or business results. GitHub's own eligibility rules apply. Manipulated or abusive profiles may be hidden with an audit record. Sponsors cannot buy positions.",
        ],
      ],
    },
    privacy: {
      title: "Your progress. Your choice.",
      sections: [
        [
          "What we store",
          "After GitHub authorization we store account identity, email for authentication, encrypted OAuth credentials, public profile information and daily public contribution counters. We store session information for access control. We do not request private repository access.",
        ],
        [
          "Publication and agent access",
          "Your profile is published only after acceptance. You can unpublish, revoke any delegated agent key or delete your account in the dashboard. Agent secrets are hashed, limited to specific permissions and expire after 90 days. Delegated agents do not receive GitHub tokens.",
        ],
        [
          "Advertising and enquiries",
          "We record deduplicated advertisement exposure and click events, retaining individual events for 48 hours and daily campaign totals for 12 months. We do not install advertiser tracking scripts. Commercial enquiries are available only to administrators. We use essential authentication cookies; no cross-site advertising cookie is required.",
        ],
        [
          "Retention and deletion",
          "Detailed activity is retained for 60 days and daily rank history for 30 days. Pending registrations expire after 60 minutes. Approval then allows about 10 minutes to finish registration. Expired entries are removed within 24 hours. Deletion removes account data from the active database. Server-managed backups may retain older data until their retention period ends.",
        ],
        [
          "Contact",
          "For privacy requests, open a private contact through the operator's GitHub profile or use the commercial contact form with a privacy-related message. Never send credentials or private repository content.",
        ],
      ],
    },
    terms: {
      title: "A fair place to show up.",
      sections: [
        [
          "Participation",
          "Use a personal GitHub account you control and publish only information you are entitled to share. You may authorize agents to act for you within the offered permissions. Do not impersonate another person or manipulate activity to mislead others.",
        ],
        [
          "The ranking",
          "This service reports public GitHub activity among registered participants. It is not a professional certification, hiring assessment or guarantee of productive work. Data may be delayed or unavailable. Ranking methodology and operational limits are public.",
        ],
        [
          "Sponsorships",
          "Advertisements are labelled and do not influence the ranking. Campaigns are agreed and paid outside this website. Display estimates are reporting aids, not a guarantee of sales, unique viewers or outcomes.",
        ],
        [
          "Account control",
          "You may unpublish or delete your account at any time. Access that violates these rules may be suspended, with administrative actions recorded. Third-party services retain their own terms and availability.",
        ],
      ],
    },
  };
export async function generateMetadata({
  params,
}: {
  params: Promise<{ info: string }>;
}): Promise<Metadata> {
  const { info } = await params;
  return infoMetadata(info) ?? { title: "Not found" };
}
export default async function Info({
  params,
}: {
  params: Promise<{ info: string }>;
}) {
  const { info } = await params;
  const page = content[info];
  if (!page) notFound();
  return (
    <article className="prose">
      <div className="eyebrow">
        {config().APP_NAME} / {info}
      </div>
      <h1>{page.title}</h1>
      {page.sections.map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
    </article>
  );
}
