/**
 * Tiny TTL cache with stale-while-revalidate and in-flight de-duplication.
 * Keeps upstream calls to a handful per TTL window no matter how many visitors arrive.
 */
export class TtlCache {
  constructor() { this.entries = new Map(); }

  /**
   * @param {string} key
   * @param {() => Promise<any>} loader
   * @param {{ttlMs:number, staleMs?:number}} opts  ttl = fresh window; stale = how long old data may still be served while a refresh runs
   */
  async get(key, loader, { ttlMs, staleMs = ttlMs * 12 }) {
    const now = Date.now();
    let e = this.entries.get(key);
    if (!e) { e = { value: undefined, at: 0, inflight: null }; this.entries.set(key, e); }

    const fresh = e.value !== undefined && now - e.at < ttlMs;
    const usable = e.value !== undefined && now - e.at < ttlMs + staleMs;
    if (fresh) return e.value;

    if (!e.inflight) {
      e.inflight = loader()
        .then((v) => { e.value = v; e.at = Date.now(); return v; })
        .catch((err) => { if (usable) return e.value; throw err; })
        .finally(() => { e.inflight = null; });
    }
    return usable ? e.value : e.inflight;
  }

  peek(key) { return this.entries.get(key)?.value; }
  clear() { this.entries.clear(); }
}
