import { expect, it } from "vitest";
import { SocialImageCache } from "../../src/lib/social-image";
it("bounds concurrent card rendering, shares pending work and caches complete images", async () => {
  const cache = new SocialImageCache();
  let finish!: (bytes: ArrayBuffer) => void;
  let renders = 0;
  const first = cache.get("a", () => {
    renders++;
    return new Promise<ArrayBuffer>((resolve) => {
      finish = resolve;
    });
  });
  const duplicate = cache.get("a", async () => {
    throw new Error("duplicate renderer");
  });
  const second = cache.get("b", async () => new ArrayBuffer(8));
  expect(await cache.get("c", async () => new ArrayBuffer(8))).toBeNull();
  await second;
  const bytes = new ArrayBuffer(4);
  finish(bytes);
  expect(await first).toBe(bytes);
  expect(await duplicate).toBe(bytes);
  expect(
    await cache.get("a", async () => {
      throw new Error("cached renderer");
    }),
  ).toBe(bytes);
  expect(renders).toBe(1);
});
it("releases rendering capacity after an image fails", async () => {
  const cache = new SocialImageCache();
  await expect(
    cache.get("failed", async () => {
      throw new Error("render failed");
    }),
  ).rejects.toThrow("render failed");
  expect(
    await cache.get("failed", async () => new ArrayBuffer(4)),
  ).toBeInstanceOf(ArrayBuffer);
});
