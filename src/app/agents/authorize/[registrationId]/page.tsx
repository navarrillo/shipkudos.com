import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { sql } from "@/db";
import { getAuth } from "@/lib/auth";
import { authorizationStatusMessage } from "@/lib/agents";
import { ownProfile } from "@/lib/data";
import { SignIn } from "@/components/actions";
import { Authorize } from "@/components/authorize";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Authorize your agent",
  robots: { index: false, follow: false },
};
export default async function Authorization({
  params,
}: {
  params: Promise<{ registrationId: string }>;
}) {
  const { registrationId } = await params;
  if (!z.uuid().safeParse(registrationId).success || !process.env.DATABASE_URL)
    notFound();
  const [r] = await sql<{
    name: string;
    platform: string;
    state: string;
    created_at: Date;
    expires_at: Date;
    expired: boolean;
  }>(
    "SELECT name,platform,state,created_at,expires_at,expires_at<=now() AS expired FROM agent_registrations WHERE id=$1",
    [registrationId],
  );
  if (!r) notFound();
  const expired = Boolean(r.expired) || r.state === "expired";
  const open = r.state === "pending" && !expired;
  const created = new Date(r.created_at);
  const session = await getAuth().api.getSession({ headers: await headers() });
  const p = session ? await ownProfile(session.user.id) : null;
  return (
    <div className="prose">
      <div className="eyebrow">AGENT AUTHORIZATION</div>
      <h1>A teammate wants to help.</h1>
      <div className="panel">
        <h2>{r.name}</h2>
        <p>Platform: {r.platform} (self-declared)</p>
        <p>
          Created{" "}
          <time dateTime={created.toISOString()}>{created.toUTCString()}</time>
          .
        </p>
        {open && (
          <p className="callout" role="note">
            Only approve this if you just asked your agent to connect.
          </p>
        )}
        <ul>
          <li>Read your profile and ranking.</li>
          <li>Check synchronization and request an update.</li>
          <li>Get your public profile and share card.</li>
        </ul>
        <p className="text-xs">
          No GitHub tokens, profile editing, deletion or administrator access.
          The key expires after 90 days and can be revoked in your dashboard.
        </p>
        {open ? (
          session && p ? (
            <>
              <p>
                Connected GitHub account:{" "}
                <strong className="lime">@{p.login}</strong>
              </p>
              <Authorize id={registrationId} />
            </>
          ) : (
            <SignIn
              callbackURL={`/agents/authorize/${registrationId}`}
              label="Connect GitHub to continue"
            />
          )
        ) : (
          <p className="warning">
            {authorizationStatusMessage(
              r.state,
              expired,
              new Date(r.expires_at),
            )}
          </p>
        )}
      </div>
    </div>
  );
}
