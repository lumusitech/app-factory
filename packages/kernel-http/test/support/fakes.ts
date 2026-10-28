import type { IdempotencyRecord, IdempotencyStore } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';

/** Reloj determinista con avance manual. */
export class FixedClock implements Clock {
  #value: Date;

  constructor(start: Date) {
    this.#value = start;
  }

  now(): Date {
    return this.#value;
  }

  advance(ms: number): void {
    this.#value = new Date(this.#value.getTime() + ms);
  }

  set(value: Date): void {
    this.#value = value;
  }
}

export interface MemoryIdempotencyStore extends IdempotencyStore {
  readonly records: Map<string, IdempotencyRecord>;
  readonly calls: { find: number; save: number };
  failFind: Error | undefined;
  failSave: Error | undefined;
}

/**
 * Store de idempotencia en memoria para los tests del interceptor: respeta el TTL
 * (usa el `clock`) y permite forzar fallos de lectura/escritura (fail-open).
 */
export function createMemoryIdempotencyStore(clock: Clock): MemoryIdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  const calls = { find: 0, save: 0 };

  const store: MemoryIdempotencyStore = {
    records,
    calls,
    failFind: undefined,
    failSave: undefined,
    async find(key: string): Promise<IdempotencyRecord | null> {
      calls.find += 1;
      if (store.failFind !== undefined) {
        throw store.failFind;
      }
      const record = records.get(key);
      if (record === undefined) {
        return null;
      }
      return record.expiresAt.getTime() > clock.now().getTime() ? record : null;
    },
    async save(record: IdempotencyRecord): Promise<void> {
      calls.save += 1;
      if (store.failSave !== undefined) {
        throw store.failSave;
      }
      if (!records.has(record.key)) {
        records.set(record.key, record);
      }
    },
  };

  return store;
}