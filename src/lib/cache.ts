type Entry<V> = { value: V; expiresAt: number };

/** Runs at most `limit` async callbacks at once; queued callers wait for a free slot. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) { active++; next(); }
    }
  };
}

/** Serializes async work per key. A timeout stops waiting for a stuck predecessor. */
export function createKeyedLock(timeoutMs?: number) {
  const locks = new Map<string, Promise<void>>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    locks.set(key, promise);
    if (timeoutMs === undefined) await previous;
    else await Promise.race([previous, new Promise(resolve => setTimeout(resolve, timeoutMs).unref())]);
    try {
      return await fn();
    } finally {
      resolve();
      if (locks.get(key) === promise) locks.delete(key);
    }
  };
}

function sweepEntries<V>(entries: Map<unknown, Entry<V>>, ttlMs: number, sweptAt: { value: number }) {
  const now = Date.now();
  if (now - sweptAt.value < ttlMs) return;
  sweptAt.value = now;
  for (const [key, entry] of entries) if (entry.expiresAt + ttlMs <= now) entries.delete(key);
}

export function ttlCacheSync<K, V>(loader: (key: K) => V, ttlMs: number) {
  const entries = new Map<K, Entry<V>>();
  const sweptAt = { value: 0 };
  return {
    get(key: K): V {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
      const value = loader(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      sweepEntries(entries, ttlMs, sweptAt);
      return value;
    },
    delete(key: K) { entries.delete(key); },
    clear() { entries.clear(); },
  };
}

export function ttlCacheAsync<K, V>(loader: (key: K) => Promise<V>, ttlMs: number, stale = false) {
  const entries = new Map<K, Entry<V>>();
  const pending = new Map<K, Promise<V>>();
  const sweptAt = { value: 0 };
  return {
    get(key: K): Promise<V> {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
      let request = pending.get(key);
      if (!request) {
        request = loader(key).then(value => {
          entries.set(key, { value, expiresAt: Date.now() + ttlMs });
          return value;
        }).catch(error => {
          const entry = entries.get(key);
          if (stale && entry) {
            // Keep serving the stale value without hammering a failing upstream on every call.
            entry.expiresAt = Date.now() + ttlMs;
            return entry.value;
          }
          throw error;
        }).finally(() => { pending.delete(key); });
        pending.set(key, request);
        sweepEntries(entries, ttlMs, sweptAt);
      }
      return request;
    },
  };
}
