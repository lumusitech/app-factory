import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import { requireScope } from '@kernel/scope';

import type { ConfigEntry, ConfigEntryRepository, ConfigSchemaRegistry, ConfigValue } from '../../src/index.js';

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
}

/** IDs deterministas para aserciones de eventos. */
export class SequentialIdGenerator implements IdGenerator {
  #counter = 0;

  next(): string {
    this.#counter += 1;
    return `id-${this.#counter}`;
  }
}

export interface InMemoryConfigRepository extends ConfigEntryRepository {
  readonly entries: Map<string, ConfigEntry>;
  readonly events: DomainEvent[];
  saves(): number;
}

function entryKey(tenantId: string, key: string): string {
  return `${tenantId}\u0000${key}`;
}

/**
 * Repositorio en memoria que **imita al adaptador real**: `byKey` toma el tenant
 * del `ScopeContext` (fail-closed) y `save` incluye el outbox (aquí, una lista).
 */
export function createInMemoryConfigRepository(): InMemoryConfigRepository {
  const entries = new Map<string, ConfigEntry>();
  const events: DomainEvent[] = [];
  let saves = 0;

  return {
    entries,
    events,
    saves: () => saves,
    async byKey(key: string): Promise<ConfigEntry | null> {
      const tenantId = requireScope().tenantId;
      return entries.get(entryKey(tenantId, key)) ?? null;
    },
    async save(entry: ConfigEntry): Promise<void> {
      saves += 1;
      entries.set(entryKey(entry.tenantId, entry.key), entry);
      events.push(...entry.pullEvents());
    },
  };
}

export interface RegistryKey {
  readonly version: number;
  readonly accepts: (value: ConfigValue) => boolean;
}

/** Catálogo de la vertical para los tests: claves → (versión, predicado). */
export function createRegistry(keys: Record<string, RegistryKey>): ConfigSchemaRegistry {
  return {
    currentVersion(key: string): number | null {
      return keys[key]?.version ?? null;
    },
    isValid(key: string, schemaVersion: number, value: ConfigValue): boolean {
      const entry = keys[key];
      if (entry === undefined || entry.version !== schemaVersion) {
        return false;
      }
      return entry.accepts(value);
    },
  };
}