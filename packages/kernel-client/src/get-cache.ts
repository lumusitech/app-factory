import type { Clock } from '@kernel/domain';

import { CacheError } from './errors.js';
import type { GetCacheStore } from './ports/get-cache-store.js';
import type { Transport } from './ports/transport.js';

/** TTL de la caché GET (§1.1): 7 días. No se re-litiga. */
export const GET_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Tamaño máximo de la caché GET (§1.1): LRU de 500 entradas. */
export const GET_CACHE_MAX_ENTRIES = 500;

export interface GetCacheDependencies {
  readonly clock: Clock;
  readonly transport: Transport;
  readonly store: GetCacheStore;
  /** TTL en ms; por defecto 7 días (§1.1). */
  readonly ttlMs?: number;
  /** Máximo de entradas; por defecto 500 (§1.1). */
  readonly maxEntries?: number;
}

/**
 * Caché GET offline (§1.1): TTL 7 días, LRU 500, guarda el body **ya
 * desenvuelto**. Lee de la caché; en *miss* (o vencida) hace el GET por el
 * `Transport` y guarda el `data` del envelope.
 *
 * Es independiente de la cola: las lecturas no se encolan (sync §1).
 */
export class GetCache {
  readonly #clock: Clock;
  readonly #transport: Transport;
  readonly #store: GetCacheStore;
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(dependencies: GetCacheDependencies) {
    this.#clock = dependencies.clock;
    this.#transport = dependencies.transport;
    this.#store = dependencies.store;
    this.#ttlMs = dependencies.ttlMs ?? GET_CACHE_TTL_MS;
    this.#maxEntries = dependencies.maxEntries ?? GET_CACHE_MAX_ENTRIES;
  }

  /**
   * Lectura read-through: devuelve el `data` desenvuelto. Los llamadores que
   * quieren el control total pueden usar `peek`/`store`, pero `read` es el camino
   * de la UI.
   */
  async read<T>(key: string, path: string): Promise<T> {
    const now = this.#clock.now();
    const cached = await this.#store.get(key);

    if (cached !== null && !this.#isExpired(cached.storedAt, now)) {
      await this.#store.set({ ...cached, lastAccessedAt: now.toISOString() });
      return cached.data as T;
    }

    const result = await this.#transport.send({ method: 'GET', path, headers: {} });
    if (result.kind === 'network-error') {
      throw new CacheError(`Sin conexión y sin caché válida para ${path}.`);
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new CacheError(`La lectura de ${path} falló con status ${result.statusCode}.`);
    }

    const data = unwrapEnvelope(result.body, path);
    const stamp = now.toISOString();
    await this.#store.set({ key, data, storedAt: stamp, lastAccessedAt: stamp });
    await this.#evict();

    return data as T;
  }

  #isExpired(storedAt: string, now: Date): boolean {
    const stored = Date.parse(storedAt);
    if (Number.isNaN(stored)) {
      return true;
    }
    return now.getTime() - stored >= this.#ttlMs;
  }

  /** Desalojo LRU: si se supera `maxEntries`, borra los de acceso más antiguo. */
  async #evict(): Promise<void> {
    const entries = await this.#store.list();
    if (entries.length <= this.#maxEntries) {
      return;
    }

    const byLeastRecentlyUsed = [...entries].sort(
      (a, b) => Date.parse(a.lastAccessedAt) - Date.parse(b.lastAccessedAt),
    );
    const excess = entries.length - this.#maxEntries;

    for (let i = 0; i < excess; i += 1) {
      const entry = byLeastRecentlyUsed[i];
      if (entry !== undefined) {
        await this.#store.delete(entry.key);
      }
    }
  }
}

/** Desenvuelve el `data` del envelope del kernel (§1.1: guardar ya desenvuelto). */
function unwrapEnvelope(body: unknown, path: string): unknown {
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  throw new CacheError(`La respuesta de ${path} no tiene forma de envelope del kernel.`);
}
