/** Bound expensive PNG rendering and memory use independently of visitor volume. */
export class SocialImageCache {
  private entries = new Map<string, { expires: number; bytes: ArrayBuffer }>();
  private running = new Map<string, Promise<ArrayBuffer>>();
  private size = 0;
  async get(
    key: string,
    render: () => Promise<ArrayBuffer>,
  ): Promise<ArrayBuffer | null> {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expires <= now) {
        this.size -= entry.bytes.byteLength;
        this.entries.delete(id);
      }
    }
    const hit = this.entries.get(key);
    if (hit) return hit.bytes;
    const pending = this.running.get(key);
    if (pending) return pending;
    if (this.running.size >= 2) return null;
    const task = Promise.resolve()
      .then(render)
      .then((bytes) => {
        if (bytes.byteLength <= 2 * 1024 * 1024) {
          while (
            this.entries.size >= 64 ||
            this.size + bytes.byteLength > 16 * 1024 * 1024
          ) {
            const oldest = this.entries.entries().next().value;
            if (!oldest) break;
            this.size -= oldest[1].bytes.byteLength;
            this.entries.delete(oldest[0]);
          }
          this.entries.set(key, { bytes, expires: Date.now() + 300000 });
          this.size += bytes.byteLength;
        }
        return bytes;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, task);
    return task;
  }
}
export const socialImages = new SocialImageCache();
