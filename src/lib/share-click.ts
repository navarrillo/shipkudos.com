export type SharePayload = {
  text: string;
  url: string;
};

export type ShareProfileTarget = {
  text: string;
  profileUrl: string;
  intentUrl: string;
};

export type ShareClickEvent = {
  preventDefault(): void;
};

export type ShareClickEnvironment = {
  share?: (data: SharePayload) => Promise<void> | void;
  coarsePointer: boolean;
  open: (url: string) => void;
};

const COARSE_POINTER = "(pointer: coarse)";

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  );
}

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

function canNativeShare(
  env: ShareClickEnvironment,
): env is ShareClickEnvironment & {
  share: (data: SharePayload) => Promise<void> | void;
} {
  return typeof env.share === "function" && env.coarsePointer;
}

/**
 * Touch devices with the Web Share API open the OS sheet (`text` and `url`
 * stay separate). Cancel is a no-op. Any other failure, or a device without
 * native share, leaves the intent URL to open in a new tab.
 */
export function onShareProfileClick(
  event: ShareClickEvent,
  target: ShareProfileTarget,
  env: ShareClickEnvironment,
): Promise<void> | void {
  if (!canNativeShare(env)) return;
  event.preventDefault();
  let pending: Promise<void> | void;
  try {
    pending = env.share({ text: target.text, url: target.profileUrl });
  } catch (error) {
    if (!isAbortError(error)) env.open(target.intentUrl);
    return;
  }
  return Promise.resolve(pending).catch((error: unknown) => {
    if (isAbortError(error)) return;
    env.open(target.intentUrl);
  });
}
