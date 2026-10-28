"use client";

import type { MouseEvent } from "react";
import {
  isMobileClient,
  onShareProfileClick,
  watchPageHide,
  type ShareClickEnvironment,
} from "@/lib/share-click";

function shareEnvironment(): ShareClickEnvironment {
  return {
    mobile: isMobileClient(
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? (query) => window.matchMedia(query)
        : undefined,
      typeof navigator !== "undefined" ? navigator.userAgent : "",
    ),
    assign: (url) => {
      window.location.assign(url);
    },
    onPageHide: (listener) => watchPageHide(document, window, listener),
    schedule: (ms, run) => {
      const id = window.setTimeout(run, ms);
      return () => window.clearTimeout(id);
    },
  };
}

export function ShareProfile({
  text,
  profileUrl,
  intentUrl,
}: {
  text: string;
  profileUrl: string;
  intentUrl: string;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    onShareProfileClick(event, { text, profileUrl, intentUrl }, shareEnvironment());
  }
  return (
    <a
      className="button button-primary"
      href={intentUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      Share profile ↗
    </a>
  );
}
