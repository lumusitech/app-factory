import type { CachedGet, GetCacheStore } from '../ports/get-cache-store.js';

/** Adaptador de referencia **en memoria** del `GetCacheStore` (tests y suite). */
export class InMemoryGetCacheStore implements GetCacheStore {
  readonly #entries = new Map<string, CachedGet>();

  async get(key: string): Promise<CachedGet | null> {
    return this.#entries.get(key) ?? null;
  }

  async set(entry: CachedGet): Promise<void> {
    this.#entries.set(entry.key, entry);
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async list(): Promise<readonly CachedGet[]> {
    return [...this.#entries.values()];
  }
}
