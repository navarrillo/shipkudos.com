"use client";

import type { MouseEvent } from "react";
import {
  isCoarsePointer,
  onShareProfileClick,
  type ShareClickEnvironment,
} from "@/lib/share-click";

function shareEnvironment(): ShareClickEnvironment {
  return {
    share:
      typeof navigator !== "undefined" && typeof navigator.share === "function"
        ? (data) => navigator.share(data)
        : undefined,
    coarsePointer: isCoarsePointer(
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? (query) => window.matchMedia(query)
        : undefined,
    ),
    open: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
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
    void onShareProfileClick(
      event,
      { text, profileUrl, intentUrl },
      shareEnvironment(),
    );
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
