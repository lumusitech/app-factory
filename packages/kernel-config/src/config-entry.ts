import { isDeepStrictEqual } from 'node:util';

import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

import { InvalidConfigKeyError, InvalidConfigValueError, UnknownConfigKeyError } from './config-errors.js';
import type { ConfigSchemaRegistry } from './config-ports.js';
import type { ConfigValue } from './config-value.js';

export const CONFIG_KEY_MAX_LENGTH = 120;

const CONFIG_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/**
 * Normaliza y valida la clave: opaca, namespaced, en minúsculas y `kebab`/`dot`
 * (`calendar.term`, `grading.thresholds`). Nunca un código corto adivinable.
 */
export function normalizeConfigKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key === '' || key.length > CONFIG_KEY_MAX_LENGTH || !CONFIG_KEY_PATTERN.test(key)) {
    throw new InvalidConfigKeyError(value);
  }
  return key;
}

export interface ConfigEntrySnapshot {
  readonly tenantId: TenantId;
  readonly key: string;
  readonly value: ConfigValue;
  readonly schemaVersion: number;
  readonly updatedAt: Date;
}

export interface ConfigEntryCreateInput {
  readonly tenantId: TenantId;
  readonly key: unknown;
  readonly value: ConfigValue;
  readonly registry: ConfigSchemaRegistry;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export interface ConfigEntryReplaceInput {
  readonly value: ConfigValue;
  readonly registry: ConfigSchemaRegistry;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

function currentSchemaVersion(key: string, registry: ConfigSchemaRegistry): number {
  const schemaVersion = registry.currentVersion(key);
  if (schemaVersion === null) {
    throw new UnknownConfigKeyError(key);
  }
  return schemaVersion;
}

function assertValid(
  key: string,
  schemaVersion: number,
  value: ConfigValue,
  registry: ConfigSchemaRegistry,
): void {
  if (!registry.isValid(key, schemaVersion, value)) {
    throw new InvalidConfigValueError(key, schemaVersion);
  }
}

/**
 * Entrada de configuración por tenant (D19; ADR 0007).
 *
 * Invariantes (no hay forma de construir una entrada sin cumplirlas):
 * - la clave está **registrada** en el catálogo de la vertical;
 * - el valor **valida** contra el esquema de su versión;
 * - `schemaVersion` lo **estampa el catálogo**, nunca el llamador;
 * - un `set` con el mismo valor **no emite evento** ni escribe.
 */
export class ConfigEntry {
  #events: DomainEvent[] = [];

  private constructor(
    readonly tenantId: TenantId,
    readonly key: string,
    readonly value: ConfigValue,
    readonly schemaVersion: number,
    readonly updatedAt: Date,
  ) {}

  static create(input: ConfigEntryCreateInput): ConfigEntry {
    const key = normalizeConfigKey(input.key);
    const schemaVersion = currentSchemaVersion(key, input.registry);
    assertValid(key, schemaVersion, input.value, input.registry);

    const now = input.clock.now();
    const entry = new ConfigEntry(input.tenantId, key, input.value, schemaVersion, now);

    entry.#events.push({
      id: input.idGenerator.next(),
      type: 'config.entry.created',
      aggregateId: key,
      occurredAt: now,
      payload: { key, schemaVersion, value: input.value },
    });

    return entry;
  }

  /**
   * Reconstruye desde persistencia **sin** revalidar contra el esquema vigente:
   * una entrada puede quedar en una versión anterior y la vertical decide cuándo
   * migrarla (ADR 0007).
   */
  static hydrate(snapshot: ConfigEntrySnapshot): ConfigEntry {
    if (!Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion < 1) {
      throw new Error('La versión de esquema de una entrada debe ser un entero >= 1.');
    }

    return new ConfigEntry(
      snapshot.tenantId,
      normalizeConfigKey(snapshot.key),
      snapshot.value,
      snapshot.schemaVersion,
      snapshot.updatedAt,
    );
  }

  /** Devuelve una entrada nueva con el valor actualizado; si no cambió, `this`. */
  replaceValue(input: ConfigEntryReplaceInput): ConfigEntry {
    const schemaVersion = currentSchemaVersion(this.key, input.registry);
    assertValid(this.key, schemaVersion, input.value, input.registry);

    if (isDeepStrictEqual(input.value, this.value)) {
      return this;
    }

    const now = input.clock.now();
    const next = new ConfigEntry(this.tenantId, this.key, input.value, schemaVersion, now);

    next.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'config.entry.updated',
        aggregateId: this.key,
        occurredAt: now,
        payload: { key: this.key, schemaVersion, value: input.value },
      },
    ];

    return next;
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): ConfigEntrySnapshot {
    return {
      tenantId: this.tenantId,
      key: this.key,
      value: this.value,
      schemaVersion: this.schemaVersion,
      updatedAt: this.updatedAt,
    };
  }
}