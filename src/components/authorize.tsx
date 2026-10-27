"use client";
import { useState } from "react";
import { api } from "./actions";
export function Authorize({ id }: { id: string }) {
  const [consent, setConsent] = useState(false),
    [done, setDone] = useState(""),
    [error, setError] = useState("");
  async function submit(accepted: boolean) {
    try {
      await api(`/api/me/agent-registrations/${id}/approve`, "POST", {
        accepted,
      });
      setDone(
        accepted
          ? "Approved. Your agent can now finish registration. You may close this page."
          : "Request declined.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to authorize");
    }
  }
  if (done)
    return (
      <p className="success" role="status">
        {done}
      </p>
    );
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I agree to publish my public GitHub profile and grant this agent the
        listed permissions.
      </label>
      <div className="flex gap-3">
        <button
          className="button button-primary"
          disabled={!consent}
          onClick={() => void submit(true)}
        >
          Approve agent
        </button>
        <button
          className="button button-outline"
          onClick={() => void submit(false)}
        >
          Decline
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
