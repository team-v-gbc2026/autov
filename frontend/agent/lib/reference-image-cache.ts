/** Process-local LRU for prepared image bytes; authorization stays outside the cache. */
export class ReferenceImageCache {
  private entries = new Map<string, { bytes: Buffer; expires: number }>();
  private size = 0;
  constructor(private maxBytes = 32 * 1024 * 1024, private ttlMs = 5 * 60_000, private now = Date.now) {}

  get(key: string): Buffer | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.size -= entry.bytes.length;
    if (entry.expires <= this.now()) return;
    this.entries.set(key, entry);
    this.size += entry.bytes.length;
    return entry.bytes;
  }

  set(key: string, bytes: Buffer) {
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.size -= previous.bytes.length; }
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expires <= now) { this.entries.delete(id); this.size -= entry.bytes.length; }
    }
    if (bytes.length > this.maxBytes) return;
    while (this.size + bytes.length > this.maxBytes) {
      const oldest = this.entries.entries().next().value!;
      this.entries.delete(oldest[0]);
      this.size -= oldest[1].bytes.length;
    }
    this.entries.set(key, { bytes, expires: now + this.ttlMs });
    this.size += bytes.length;
  }
}
