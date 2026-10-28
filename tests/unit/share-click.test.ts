import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShareProfile } from "../../src/components/share-profile";
import {
  APP_OPEN_FALLBACK_MS,
  isCoarsePointer,
  isMobileClient,
  onShareProfileClick,
  shareMessage,
  watchPageHide,
  xAppDeepLink,
  type ShareClickEnvironment,
  type ShareProfileTarget,
} from "../../src/lib/share-click";

const target: ShareProfileTarget = {
  text: "Shipped on 7 of the last 7 days.",
  profileUrl: "https://shipkudos.com/u/ada",
  intentUrl:
    "https://x.com/intent/post?text=Shipped%20on%207%20of%20the%20last%207%20days.&url=https%3A%2F%2Fshipkudos.com%2Fu%2Fada",
};

const posted = `${target.text}\n\n${target.profileUrl}`;

function click() {
  return { preventDefault: vi.fn() };
}

function occurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

function harness(mobile: boolean) {
  const assign = vi.fn();
  const cancelTimer = vi.fn();
  const unsubscribe = vi.fn();
  let hide: (() => void) | undefined;
  let timer: (() => void) | undefined;
  const env: ShareClickEnvironment = {
    mobile,
    assign,
    onPageHide: (listener) => {
      hide = listener;
      return unsubscribe;
    },
    schedule: (ms, run) => {
      expect(ms).toBe(APP_OPEN_FALLBACK_MS);
      timer = run;
      return cancelTimer;
    },
  };
  return {
    env,
    assign,
    cancelTimer,
    unsubscribe,
    hide: () => hide?.(),
    elapse: () => timer?.(),
  };
}

describe("share profile click", () => {
  it("opens the X app deep link in this tab on mobile", () => {
    const event = click();
    const h = harness(true);
    onShareProfileClick(event, target, h.env);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledWith(xAppDeepLink(posted));
    const decoded = decodeURIComponent(
      String(h.assign.mock.calls[0][0]).slice("twitter://post?message=".length),
    );
    expect(decoded).toBe(posted);
    expect(occurrences(decoded, target.profileUrl)).toBe(1);
  });

  it("falls back to the web intent in the same tab when the page stays visible", () => {
    const event = click();
    const h = harness(true);
    onShareProfileClick(event, target, h.env);
    h.elapse();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.cancelTimer).not.toHaveBeenCalled();
    expect(h.assign).toHaveBeenCalledTimes(2);
    const fallback = String(h.assign.mock.calls[1][0]);
    const parsed = new URL(fallback);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://x.com/intent/post");
    expect(parsed.searchParams.get("text")).toBe(posted);
    expect(parsed.searchParams.has("url")).toBe(false);
    expect(occurrences(parsed.searchParams.get("text") ?? "", target.profileUrl)).toBe(
      1,
    );
    expect(fallback).toBe(
      `https://x.com/intent/post?text=${encodeURIComponent(posted)}`,
    );
  });

  it("cancels the web intent fallback when visibilitychange reports hidden", () => {
    const event = click();
    const h = harness(true);
    onShareProfileClick(event, target, h.env);
    const deepLink = h.assign.mock.calls[0][0];
    h.hide();
    expect(h.cancelTimer).toHaveBeenCalledTimes(1);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    h.elapse();
    expect(h.assign).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledWith(deepLink);
  });

  it("leaves the desktop intent link to open in a new tab", () => {
    const event = click();
    const assign = vi.fn();
    const schedule = vi.fn();
    const onPageHide = vi.fn();
    onShareProfileClick(event, target, {
      mobile: false,
      assign,
      schedule,
      onPageHide,
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(onPageHide).not.toHaveBeenCalled();
  });

  it("encodes the deep-link message and includes the profile URL exactly once", () => {
    const text =
      "#1 on the ShipKudos 7-day board 🏁\n\n126 public contributions, 7/7 days shipping with Codex + Cursor + Grok.";
    const message = shareMessage(text, target.profileUrl);
    expect(message).toBe(`${text}\n\n${target.profileUrl}`);
    expect(occurrences(message, target.profileUrl)).toBe(1);
    const link = xAppDeepLink(message);
    expect(link).toBe(`twitter://post?message=${encodeURIComponent(message)}`);
    expect(link).not.toContain(" ");
    expect(link).not.toContain("\n");
    expect(link).not.toContain("+");
    const decoded = decodeURIComponent(link.slice("twitter://post?message=".length));
    expect(decoded).toBe(message);
    expect(occurrences(decoded, target.profileUrl)).toBe(1);
    expect(shareMessage(message, target.profileUrl)).toBe(message);
  });

  it("detects phones by a coarse pointer or an iOS or Android user agent", () => {
    const coarse = (query: string) => ({ matches: query === "(pointer: coarse)" });
    expect(isCoarsePointer(coarse)).toBe(true);
    expect(isCoarsePointer(() => ({ matches: false }))).toBe(false);
    expect(isCoarsePointer(undefined)).toBe(false);
    expect(
      isCoarsePointer(() => {
        throw new Error("matchMedia unavailable");
      }),
    ).toBe(false);
    expect(isMobileClient(coarse, "Mozilla/5.0 (Macintosh)")).toBe(true);
    expect(
      isMobileClient(
        () => ({ matches: false }),
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      ),
    ).toBe(true);
    expect(
      isMobileClient(
        () => ({ matches: false }),
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)",
      ),
    ).toBe(true);
    expect(
      isMobileClient(
        () => ({ matches: false }),
        "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      ),
    ).toBe(true);
    expect(
      isMobileClient(
        () => ({ matches: false }),
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      ),
    ).toBe(false);
    expect(isMobileClient(undefined, "")).toBe(false);
  });

  it("treats a hidden visibilitychange and pagehide as the app opening", () => {
    let visibilityState = "visible";
    const docListeners = new Map<string, () => void>();
    const winListeners = new Map<string, () => void>();
    const onHide = vi.fn();
    const stop = watchPageHide(
      {
        get visibilityState() {
          return visibilityState;
        },
        addEventListener: (type, listener) => {
          docListeners.set(type, listener);
        },
        removeEventListener: (type) => {
          docListeners.delete(type);
        },
      },
      {
        addEventListener: (type, listener) => {
          winListeners.set(type, listener);
        },
        removeEventListener: (type) => {
          winListeners.delete(type);
        },
      },
      onHide,
    );
    expect(docListeners.has("visibilitychange")).toBe(true);
    expect(winListeners.has("pagehide")).toBe(true);
    docListeners.get("visibilitychange")?.();
    expect(onHide).not.toHaveBeenCalled();
    visibilityState = "hidden";
    docListeners.get("visibilitychange")?.();
    winListeners.get("pagehide")?.();
    expect(onHide).toHaveBeenCalledTimes(2);
    stop();
    expect(docListeners.size).toBe(0);
    expect(winListeners.size).toBe(0);
  });
});

describe("share profile anchor", () => {
  it("renders a crawlable intent link that works without JavaScript", () => {
    const html = renderToStaticMarkup(
      createElement(ShareProfile, {
        text: target.text,
        profileUrl: target.profileUrl,
        intentUrl: target.intentUrl,
      }),
    );
    expect(html).toContain(`href="${target.intentUrl.replaceAll("&", "&amp;")}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Share profile ↗");
    expect(html.startsWith("<a ")).toBe(true);
  });
});
