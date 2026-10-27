"use client";
import { useState } from "react";
import { api } from "./actions";
export function LeadForm() {
  const [state, setState] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const form = new FormData(e.currentTarget);
        try {
          await api("/api/advertiser-leads", "POST", Object.fromEntries(form));
          setState(
            "Thanks. Your enquiry is saved and will be reviewed by the team.",
          );
        } catch (e) {
          setState(e instanceof Error ? e.message : "Please try again");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Let’s find your next users.</h2>
      <div className="field">
        <label htmlFor="lead-name">Your name or company</label>
        <input id="lead-name" name="name" required maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="lead-email">Work email</label>
        <input id="lead-email" name="email" type="email" required />
      </div>
      <div className="field">
        <label htmlFor="lead-url">Product URL</label>
        <input id="lead-url" name="url" type="url" required />
      </div>
      <div className="field">
        <label htmlFor="lead-message">
          Tell us about the product and campaign
        </label>
        <textarea
          id="lead-message"
          name="message"
          minLength={10}
          maxLength={3000}
          required
        />
      </div>
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <button disabled={busy} className="button button-primary">
        {busy ? "Sending…" : "Start a conversation →"}
      </button>
      {state && (
        <p role="status" className="mt-4 text-sm">
          {state.replaceAll("_", " ")}
        </p>
      )}
    </form>
  );
}
