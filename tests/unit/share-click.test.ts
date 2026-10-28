import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShareProfile } from "../../src/components/share-profile";
import {
  isCoarsePointer,
  onShareProfileClick,
  type ShareProfileTarget,
} from "../../src/lib/share-click";

const target: ShareProfileTarget = {
  text: "Shipped on 7 of the last 7 days.",
  profileUrl: "https://shipkudos.com/u/ada",
  intentUrl:
    "https://x.com/intent/post?text=Shipped%20on%207%20of%20the%20last%207%20days.&url=https%3A%2F%2Fshipkudos.com%2Fu%2Fada",
};

function click() {
  return { preventDefault: vi.fn() };
}

describe("share profile click", () => {
  it("opens the native share sheet on a coarse pointer without putting the url in the text", async () => {
    const event = click();
    const share = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    await onShareProfileClick(event, target, {
      share,
      coarsePointer: true,
      open,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      text: target.text,
      url: target.profileUrl,
    });
    expect(share.mock.calls[0][0].text).not.toContain(target.profileUrl);
    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels the share sheet", async () => {
    const event = click();
    const share = vi.fn().mockRejectedValue(
      Object.assign(new Error("Share canceled"), { name: "AbortError" }),
    );
    const open = vi.fn();
    await onShareProfileClick(event, target, {
      share,
      coarsePointer: true,
      open,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the intent url in a new tab when native share fails", async () => {
    const event = click();
    const share = vi.fn().mockRejectedValue(
      Object.assign(new Error("Share failed"), { name: "NotAllowedError" }),
    );
    const open = vi.fn();
    await onShareProfileClick(event, target, {
      share,
      coarsePointer: true,
      open,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(target.intentUrl);
  });

  it("opens the intent url when native share throws synchronously", () => {
    const event = click();
    const open = vi.fn();
    onShareProfileClick(event, target, {
      share: () => {
        throw Object.assign(new Error("bad share data"), { name: "TypeError" });
      },
      coarsePointer: true,
      open,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(target.intentUrl);
  });

  it("treats a synchronous cancel as a no-op", () => {
    const event = click();
    const open = vi.fn();
    onShareProfileClick(event, target, {
      share: () => {
        throw Object.assign(new Error("canceled"), { name: "AbortError" });
      },
      coarsePointer: true,
      open,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves the intent link to the browser on desktop and when share is missing", () => {
    const open = vi.fn();
    const share = vi.fn();
    const desktop = click();
    onShareProfileClick(desktop, target, {
      share,
      coarsePointer: false,
      open,
    });
    const missing = click();
    onShareProfileClick(missing, target, {
      coarsePointer: true,
      open,
    });
    expect(desktop.preventDefault).not.toHaveBeenCalled();
    expect(missing.preventDefault).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("detects a coarse pointer without sniffing the user agent", () => {
    expect(
      isCoarsePointer((query) => ({ matches: query === "(pointer: coarse)" })),
    ).toBe(true);
    expect(isCoarsePointer(() => ({ matches: false }))).toBe(false);
    expect(isCoarsePointer(undefined)).toBe(false);
    expect(
      isCoarsePointer(() => {
        throw new Error("matchMedia unavailable");
      }),
    ).toBe(false);
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
