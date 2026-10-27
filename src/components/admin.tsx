"use client";
import { useEffect, useState } from "react";
import { api, SignIn } from "./actions";
import { stockholmToISO } from "@/lib/domain";
type Row = Record<string, string | number | string[] | null>;
type Overview = {
  profiles: Row[];
  campaigns: Row[];
  advertisers: Row[];
  leads: Row[];
  metrics: Row[];
  jobs: Row[];
};
export function Admin() {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<Row | null>(null);
  const load = async () => {
    try {
      setData(await api("/api/admin/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      setNotice("Saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    }
  }
  if (!data)
    return (
      <div className="panel">
        <h2>Administrator access</h2>
        <p>{error || "Loading…"}</p>
        <SignIn callbackURL="/admin" />
      </div>
    );
  return (
    <>
      <div className="toolbar">
        <span className="pill">ADMINISTRATOR</span>
        <a href="/api/admin/metrics.csv" className="button button-outline">
          Export campaign CSV ↓
        </a>
      </div>
      {error && (
        <p role="alert" className="error">
          {error.replaceAll("_", " ")}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="grid-two">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void act(async () => {
              await api(
                "/api/admin/advertisers",
                "POST",
                Object.fromEntries(new FormData(form)),
              );
              form.reset();
            });
          }}
        >
          <h2>Add an advertiser</h2>
          <div className="field">
            <label>
              Name
              <input name="name" required maxLength={100} />
            </label>
          </div>
          <div className="field">
            <label>
              Contact email
              <input type="email" name="email" required />
            </label>
          </div>
          <button className="button button-outline">Create advertiser</button>
        </form>
        <div className="panel">
          <h2>Estimated campaign results</h2>
          {data.metrics.length ? (
            data.metrics.map((r) => (
              <div className="credential" key={String(r.campaign_id)}>
                <strong>{r.title}</strong>
                <small>
                  {r.impressions} impressions · {r.clicks} clicks ·{" "}
                  {Number(r.impressions)
                    ? (
                        (Number(r.clicks) / Number(r.impressions)) *
                        100
                      ).toFixed(2)
                    : "0.00"}
                  % CTR
                </small>
              </div>
            ))
          ) : (
            <p>No exposure events yet.</p>
          )}
        </div>
      </div>
      <form
        key={String(editing?.id || "new")}
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void act(async () => {
            let image = editing?.image || null;
            const file = form.get("image");
            if (file instanceof File && file.size) {
              const upload = new FormData();
              upload.set("file", file);
              const response = await fetch("/api/admin/uploads", {
                method: "POST",
                body: upload,
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error);
              image = result.image;
            }
            await api("/api/admin/campaigns", "POST", {
              id: editing?.id,
              advertiserId: form.get("advertiserId"),
              title: form.get("title"),
              description: form.get("description"),
              url: form.get("url"),
              image,
              placements: form.getAll("placements"),
              startsAt: stockholmToISO(String(form.get("startsAt"))),
              endsAt: stockholmToISO(String(form.get("endsAt"))),
              status: form.get("status"),
            });
            setEditing(null);
          });
        }}
      >
        <h2>{editing ? "Edit campaign" : "Schedule a campaign"}</h2>
        <div className="grid-two">
          <div>
            <div className="field">
              <label>
                Advertiser
                <select
                  name="advertiserId"
                  defaultValue={String(editing?.advertiser_id || "")}
                  required
                >
                  <option value="">Select advertiser</option>
                  {data.advertisers.map((a) => (
                    <option key={String(a.id)} value={String(a.id)}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field">
              <label>
                Title
                <input
                  name="title"
                  defaultValue={String(editing?.title || "")}
                  required
                  maxLength={80}
                />
              </label>
            </div>
            <div className="field">
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={String(editing?.description || "")}
                  required
                  maxLength={240}
                />
              </label>
            </div>
            <div className="field">
              <label>
                Destination URL
                <input
                  name="url"
                  type="url"
                  defaultValue={String(editing?.url || "")}
                  required
                />
              </label>
            </div>
          </div>
          <div>
            <div className="field">
              <label>
                Starts (Europe/Stockholm)
                <input
                  type="datetime-local"
                  name="startsAt"
                  required
                  defaultValue={
                    editing?.starts_at
                      ? new Intl.DateTimeFormat("sv-SE", {
                          timeZone: "Europe/Stockholm",
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                          .format(new Date(String(editing.starts_at)))
                          .replace(" ", "T")
                      : undefined
                  }
                />
              </label>
            </div>
            <div className="field">
              <label>
                Ends (Europe/Stockholm)
                <input
                  type="datetime-local"
                  name="endsAt"
                  required
                  defaultValue={
                    editing?.ends_at
                      ? new Intl.DateTimeFormat("sv-SE", {
                          timeZone: "Europe/Stockholm",
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                          .format(new Date(String(editing.ends_at)))
                          .replace(" ", "T")
                      : undefined
                  }
                />
              </label>
            </div>
            <div className="field">
              <label>
                Status
                <select
                  name="status"
                  defaultValue={String(editing?.status || "draft")}
                >
                  {["draft", "active", "paused", "ended"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="field">
              <label>
                Creative (PNG, JPEG or WebP; max 1 MB)
                <input
                  type="file"
                  name="image"
                  accept="image/png,image/jpeg,image/webp"
                />
              </label>
            </div>
            <div className="flex gap-4">
              {["primary", "tool"].map((p) => (
                <label className="check" key={p}>
                  <input
                    type="checkbox"
                    name="placements"
                    value={p}
                    defaultChecked={
                      Array.isArray(editing?.placements) &&
                      editing.placements.includes(p)
                    }
                  />
                  {p}
                </label>
              ))}
            </div>
          </div>
        </div>
        <button className="button button-primary">Save campaign</button>
        {editing && (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => setEditing(null)}
          >
            Cancel edit
          </button>
        )}
      </form>
      <div className="panel">
        <h2>Campaigns</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Starts</th>
                <th>Ends</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={String(c.id)}>
                  <td>{c.title}</td>
                  <td>{c.status}</td>
                  <td>
                    {new Date(String(c.starts_at)).toLocaleString("en", {
                      timeZone: "Europe/Stockholm",
                    })}
                  </td>
                  <td>
                    {new Date(String(c.ends_at)).toLocaleString("en", {
                      timeZone: "Europe/Stockholm",
                    })}
                  </td>
                  <td>
                    <button
                      className="button button-outline button-small"
                      onClick={() => setEditing(c)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h2>Commercial enquiries</h2>
        {data.leads.map((l) => (
          <div className="credential" key={String(l.id)}>
            <div>
              <strong>
                {l.name} · {l.email}
              </strong>
              <p>{l.message}</p>
              <small>{l.url}</small>
            </div>
            <select
              aria-label={`Status of ${l.name}`}
              value={String(l.status)}
              onChange={(e) =>
                void act(() =>
                  api("/api/admin/leads", "PATCH", {
                    id: l.id,
                    status: e.target.value,
                  }),
                )
              }
            >
              {["new", "conversation", "closed"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        ))}
        {!data.leads.length && <p>No enquiries yet.</p>}
      </div>
      <div className="panel">
        <h2>Participants and syncs</h2>
        {data.profiles.map((p) => (
          <div className="credential" key={String(p.id)}>
            <div>
              <strong>@{p.login}</strong>
              <small>
                {p.sync_state} · {p.hidden_at ? "hidden" : "visible"} ·{" "}
                {p.last_sync_at
                  ? new Date(String(p.last_sync_at)).toUTCString()
                  : "not synced"}
              </small>
            </div>
            <div className="flex gap-2">
              <button
                className="button button-outline button-small"
                onClick={() =>
                  void act(() => api("/api/admin/retry", "POST", { id: p.id }))
                }
              >
                Retry sync
              </button>
              <button
                className="button button-outline button-small"
                onClick={() => {
                  const reason = prompt(
                    "Reason for moderation (recorded in the audit log)",
                  );
                  if (reason)
                    void act(() =>
                      api("/api/admin/profiles", "POST", {
                        id: p.id,
                        hidden: !p.hidden_at,
                        reason,
                      }),
                    );
                }}
              >
                {p.hidden_at ? "Restore" : "Hide"}
              </button>
            </div>
          </div>
        ))}
        <div className="divider" />
        <h3>Recent jobs</h3>
        {data.jobs.slice(0, 10).map((j) => (
          <p className="text-xs mono" key={String(j.id)}>
            @{j.login} · {j.state} {j.error_code ? `· ${j.error_code}` : ""}
          </p>
        ))}
      </div>
    </>
  );
}
