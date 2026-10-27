"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, SignIn } from "./actions";
import { TOOLS } from "@/lib/domain";
import type { Profile } from "@/lib/data";
type Credential = {
  id: string;
  name: string;
  platform: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};
export function Dashboard({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null),
    [credentials, setCredentials] = useState<Credential[]>([]),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [consent, setConsent] = useState(false);
  const load = useCallback(async () => {
    try {
      const p = await api("/api/me");
      setProfile(p);
      setCredentials(await api("/api/me/agent-credentials"));
    } catch (e) {
      if (e instanceof Error && e.message !== "sign_in_required")
        setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!configured) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [configured, load]);
  useEffect(() => {
    if (profile?.sync_state !== "running" && profile?.sync_state !== "pending")
      return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [profile?.sync_state, load]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again");
    }
  }
  if (loading)
    return (
      <div className="panel">
        <p>Loading your workspace…</p>
      </div>
    );
  if (!profile)
    return (
      <div className="panel">
        <h2>Your public progress starts here.</h2>
        <p>
          Connect the GitHub account you control. You choose when to publish.
        </p>
        <SignIn configured={configured} />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <>
      <div className="panel">
        <div className="flex justify-between items-start gap-5">
          <div>
            <h2>@{profile.login}</h2>
            <p className="text-xs">
              GitHub identity verified.{" "}
              {profile.published_at
                ? "Your profile is public."
                : "Your profile has not been published."}
            </p>
          </div>
          <span className="pill">{profile.sync_state.toUpperCase()}</span>
        </div>
        {!profile.published_at ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I agree to publish my GitHub identity and public activity on this
              leaderboard.
            </label>
            <button
              disabled={!consent}
              className="button button-primary"
              onClick={() =>
                void action(
                  () => api("/api/me/publish", "POST", { consent: true }),
                  "Your initial sync is queued.",
                )
              }
            >
              Publish my profile →
            </button>
          </>
        ) : (
          <div className="flex gap-3 flex-wrap">
            <Link
              className="button button-primary"
              href={`/u/${profile.login}`}
            >
              View public profile ↗
            </Link>
            <button
              className="button button-outline"
              onClick={() =>
                void action(
                  () => api("/api/me/sync", "POST", {}),
                  "Update requested. One request is allowed per hour.",
                )
              }
            >
              Request update
            </button>
          </div>
        )}
        {profile.sync_state === "reconnect" && (
          <div className="notice">
            <p>GitHub authorization needs to be renewed.</p>
            <SignIn label="Reconnect GitHub" />
          </div>
        )}
        <p className="text-xs mt-5 mb-0">
          Last successful sync:{" "}
          {profile.last_sync_at
            ? new Date(profile.last_sync_at).toUTCString()
            : "not yet"}
        </p>
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void action(
            () =>
              api("/api/me", "PATCH", {
                tools: form.getAll("tools"),
                xHandle: form.get("xHandle"),
              }),
            "Preferences saved.",
          );
        }}
      >
        <h2>Your setup</h2>
        <p className="text-xs">
          These tools are self-declared, not verified usage.
        </p>
        <div className="inline-tools mb-5">
          {TOOLS.map((t) => (
            <label className="check" key={t}>
              <input
                type="checkbox"
                name="tools"
                value={t}
                defaultChecked={profile.tools.includes(t)}
              />
              {t}
            </label>
          ))}
        </div>
        <div className="field">
          <label htmlFor="xHandle">X username (optional, not verified)</label>
          <input
            id="xHandle"
            name="xHandle"
            defaultValue={profile.x_handle}
            pattern="[A-Za-z0-9_]{0,15}"
            maxLength={15}
          />
        </div>
        <button className="button button-outline">Save preferences</button>
      </form>
      <div className="panel">
        <h2>Authorized agents</h2>
        <p className="text-xs">
          Each agent has limited access. Revoking a key takes effect on its next
          request.
        </p>
        {!credentials.length ? (
          <p>
            No agents authorized yet.{" "}
            <Link className="lime" href="/agents">
              Give your bot the guide ↗
            </Link>
          </p>
        ) : (
          credentials.map((c) => (
            <div className="credential" key={c.id}>
              <div>
                <strong>
                  {c.name} · {c.platform}
                </strong>
                <small>
                  Expires {new Date(c.expires_at).toLocaleDateString("en")} ·
                  Last used{" "}
                  {c.last_used_at
                    ? new Date(c.last_used_at).toLocaleDateString("en")
                    : "never"}
                </small>
              </div>
              {c.revoked_at ? (
                <span className="subtle">Revoked</span>
              ) : (
                <button
                  className="button button-outline button-small"
                  onClick={() =>
                    void action(
                      () => api(`/api/me/agent-credentials/${c.id}`, "DELETE"),
                      "Agent access revoked.",
                    )
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="panel">
        <h3>Visibility and account</h3>
        <p className="text-xs">
          Unpublishing removes your profile and revokes agent access. Deleting
          also removes your active account data.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            className="button button-outline"
            onClick={() => {
              if (confirm("Unpublish your profile and revoke agent access?"))
                void action(
                  () => api("/api/me/publication", "DELETE"),
                  "Profile unpublished.",
                );
            }}
          >
            Unpublish
          </button>
          <button
            className="button button-ghost"
            onClick={async () => {
              if (confirm("Permanently delete your account and active data?")) {
                try {
                  await api("/api/me", "DELETE");
                  router.replace("/");
                  router.refresh();
                } catch (e) {
                  setError(String(e));
                }
              }
            }}
          >
            Delete account
          </button>
          <button
            className="button button-ghost"
            onClick={async () => {
              await api("/api/auth/sign-out", "POST", {});
              router.replace("/");
              router.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error.replaceAll("_", " ")}
        </p>
      )}
    </>
  );
}
