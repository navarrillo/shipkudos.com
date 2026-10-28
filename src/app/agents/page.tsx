import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@/lib/config";
import { agentsMetadata } from "@/lib/seo";
import { withSocial } from "@/lib/social";
export function generateMetadata(): Metadata {
  return withSocial(agentsMetadata());
}
export default function Agents() {
  const base = config().APP_URL;
  return (
    <div className="prose">
      <div className="eyebrow">FOR THE AGENTS IN YOUR CORNER</div>
      <h1>Your bot can take it from here.</h1>
      <p>
        Grok Bot, a coding assistant or your own agent can start registration,
        check your position and request an update. One GitHub account. One
        public profile.
      </p>
      <div className="panel">
        <div className="eyebrow mb-4">GIVE YOUR AGENT THIS PROMPT</div>
        <pre>{`Read ${base}/agents.md and register my GitHub profile on ${config().APP_NAME}. If you need me to authorize anything, send me the exact link. Return my public profile when it is ready.`}</pre>
      </div>
      <section aria-labelledby="agent-api-steps">
        <h2 id="agent-api-steps">For agents</h2>
        <ol>
          <li>Create a registration: POST /api/v1/agent-registrations.</li>
          <li>Send authorizationUrl to the owner to open and approve.</li>
          <li>
            Poll GET /api/v1/agent-registrations/&#123;registrationId&#125; at the
            returned interval.
          </li>
          <li>
            When approved, exchange immediately: POST
            /api/v1/agent-registrations/&#123;registrationId&#125;/exchange.
          </li>
        </ol>
        <p>
          Read the <Link href="/agents.md">agent API guide</Link> and the{" "}
          <a href="/openapi.json">OpenAPI specification</a> for details.
        </p>
      </section>
      <h2>A link when you need it.</h2>
      <ol>
        <li>Your agent starts a pending registration through our API.</li>
        <li>
          It completes the GitHub flow if you have authorized it and its
          environment permits it. Otherwise, it sends you a specific
          authorization link.
        </li>
        <li>You confirm the GitHub account and the requested access.</li>
        <li>
          The agent receives its own limited, revocable credential and returns
          your profile.
        </li>
      </ol>
      <h2>Small permissions. Clear boundaries.</h2>
      <p>
        Agents can read your profile, request a sync and get your share card.
        They cannot change your identity, edit statistics, delete your account
        or retrieve GitHub tokens. Revoke any agent from your dashboard.
      </p>
      <div className="flex gap-3 flex-wrap">
        <Link className="button button-primary" href="/agents.md">
          Read the agent guide ↗
        </Link>
        <a className="button button-outline" href="/openapi.json">
          OpenAPI specification ↗
        </a>
      </div>
      <p className="text-xs mt-5">
        An HTTP API and browser access are enough. MCP configuration is not
        required.
      </p>
    </div>
  );
}
