import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { sql } from "@/db";
import { getAuth } from "@/lib/auth";
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
  const [r] = await sql(
    "SELECT name,platform,state,expires_at,expires_at<=now() AS expired FROM agent_registrations WHERE id=$1",
    [registrationId],
  );
  if (!r) notFound();
  const expired = Boolean(r.expired);
  const session = await getAuth().api.getSession({ headers: await headers() });
  const p = session ? await ownProfile(session.user.id) : null;
  return (
    <div className="prose">
      <div className="eyebrow">AGENT AUTHORIZATION</div>
      <h1>A teammate wants to help.</h1>
      <div className="panel">
        <h2>{r.name}</h2>
        <p>Platform: {r.platform} (self-declared)</p>
        <ul>
          <li>Read your profile and ranking.</li>
          <li>Check synchronization and request an update.</li>
          <li>Get your public profile and share card.</li>
        </ul>
        <p className="text-xs">
          No GitHub tokens, profile editing, deletion or administrator access.
          The key expires after 90 days and can be revoked in your dashboard.
        </p>
        {expired || r.state !== "pending" ? (
          <p className="warning">
            This request is {expired ? "expired" : r.state}. Ask your agent to
            check its status or start a new request.
          </p>
        ) : session && p ? (
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
        )}
      </div>
    </div>
  );
}
