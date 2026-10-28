export type ShareProfileTarget = {
  text: string;
  profileUrl: string;
  intentUrl: string;
};

export type ShareClickEvent = {
  preventDefault(): void;
};

export type ShareClickEnvironment = {
  /** Phone (coarse pointer or iOS/Android user agent). Desktop leaves the link. */
  mobile: boolean;
  /** Same-tab navigation. Used for the app deep link and the web fallback. */
  assign: (url: string) => void;
  /**
   * Fired when the page is hidden (`visibilitychange` → hidden, or `pagehide`),
   * which means the X app took over. Return an unsubscribe function.
   */
  onPageHide: (listener: () => void) => () => void;
  /** Return a cancel function. The fallback delay is {@link APP_OPEN_FALLBACK_MS}. */
  schedule: (ms: number, run: () => void) => () => void;
};

/** How long to wait for the X app before opening the web composer. */
export const APP_OPEN_FALLBACK_MS = 1500;

const COARSE_POINTER = "(pointer: coarse)";
const MOBILE_UA = /iPhone|iPad|iPod|Android/i;

type HideDocument = {
  readonly visibilityState: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type HideWindow = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** Primary pointer is touch. Desktop mice stay on the intent link. */
export function isCoarsePointer(
  matchMedia?: (query: string) => { matches: boolean },
) {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia(COARSE_POINTER).matches === true;
  } catch {
    return false;
  }
}

/** iOS and Android, including a touch device whose user agent is desktop-like. */
export function isMobileClient(
  matchMedia?: (query: string) => { matches: boolean },
  userAgent?: string,
) {
  if (isCoarsePointer(matchMedia)) return true;
  return typeof userAgent === "string" && MOBILE_UA.test(userAgent);
}

/**
 * The X app keeps `message` and drops a separate url field, so the profile
 * URL has to live in the text. Append it once, with a blank line before it.
 */
export function shareMessage(text: string, profileUrl: string) {
  if (profileUrl && text.includes(profileUrl)) return text;
  if (!text) return profileUrl;
  return `${text}\n\n${profileUrl}`;
}

export function xAppDeepLink(message: string) {
  return `twitter://post?message=${encodeURIComponent(message)}`;
}

/**
 * Web composer for the same message. The profile URL is inside `text`;
 * a separate `url` param would duplicate it or be dropped by the app.
 */
export function webIntentUrl(intentUrl: string, message: string) {
  const hashAt = intentUrl.indexOf("#");
  const withoutHash = hashAt === -1 ? intentUrl : intentUrl.slice(0, hashAt);
  const queryAt = withoutHash.indexOf("?");
  const base = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  return `${base}?text=${encodeURIComponent(message)}`;
}

/** Cancel the app-open fallback once the page is actually leaving. */
export function watchPageHide(
  doc: HideDocument,
  win: HideWindow,
  onHide: () => void,
) {
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") onHide();
  };
  const onPageHide = () => onHide();
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", onPageHide);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", onPageHide);
  };
}

export function opensExternalPost(intentUrl: string) {
  try {
    const host = new URL(intentUrl).hostname;
    return host === "x.com" || host === "twitter.com";
  } catch {
    return false;
  }
}

/**
 * Phones try the X app composer in this tab. If the page is still visible
 * after {@link APP_OPEN_FALLBACK_MS}, the same tab opens the web intent.
 * Desktop clicks do not call `preventDefault`, so the link opens in a new tab.
 * A non-X intent (staging, outbound disabled) follows the link and does not open X.
 */
export function onShareProfileClick(
  event: ShareClickEvent,
  target: ShareProfileTarget,
  env: ShareClickEnvironment,
): void {
  if (!opensExternalPost(target.intentUrl)) return;
  if (!env.mobile) return;
  event.preventDefault();
  const message = shareMessage(target.text, target.profileUrl);
  let cancelTimer = () => {};
  let stopWatching = () => {};
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    cancelTimer();
    stopWatching();
  };
  stopWatching = env.onPageHide(finish);
  cancelTimer = env.schedule(APP_OPEN_FALLBACK_MS, () => {
    if (settled) return;
    settled = true;
    stopWatching();
    env.assign(webIntentUrl(target.intentUrl, message));
  });
  env.assign(xAppDeepLink(message));
}
