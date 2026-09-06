type Entry<V> = { value: V; expiresAt: number };

// Без явного sweep истёкшие записи (хэши токенов, юзеры статистики) остаются в
// map навсегда. Sweep не чаще раза за TTL; запас `ttlMs` даёт stale-fallback
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
  };
}

// Single-flight: конкуренты по одному ключу ждут один loader. С `stale` фейл
// get() снова попробует загрузить.
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
          if (stale && entries.get(key)) return entries.get(key)!.value;
          throw error;
        }).finally(() => { pending.delete(key); });
        pending.set(key, request);
        sweepEntries(entries, ttlMs, sweptAt);
      }
      return request;
    },
  };
}
