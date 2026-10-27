"use client";
import { useState } from "react";
import { ArrowUpRight, GitFork } from "lucide-react";
import { Button } from "./ui/button";
export async function api(endpoint: string, method = "GET", value?: unknown) {
  const response = await fetch(endpoint, {
    method,
    headers: value ? { "Content-Type": "application/json" } : undefined,
    body: value ? JSON.stringify(value) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message || data.error || "Please try again shortly.",
    );
  return data;
}
export function SignIn({
  callbackURL = "/dashboard",
  label = "Connect GitHub",
  configured = true,
}: {
  callbackURL?: string;
  label?: string;
  configured?: boolean;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        disabled={busy || !configured}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const data = await api("/api/auth/sign-in/social", "POST", {
              provider: "github",
              callbackURL,
            });
            if (data.url) window.location.assign(data.url);
            else throw new Error("Please try again");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to connect");
            setBusy(false);
          }
        }}
      >
        <GitFork size={17} />
        {busy ? "Connecting…" : label}
        <ArrowUpRight size={16} />
      </Button>
      {!configured && (
        <p className="subtle text-xs mt-3">
          GitHub sign-in will open when the instance is configured.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
