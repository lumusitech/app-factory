import type { Clock, IdGenerator } from '@kernel/domain';
import { requireScope } from '@kernel/scope';

import { ConfigEntry, normalizeConfigKey } from './config-entry.js';
import type { ConfigEntryRepository, ConfigSchemaRegistry } from './config-ports.js';
import type { ConfigValue } from './config-value.js';

export interface ConfigServiceDependencies {
  readonly repository: ConfigEntryRepository;
  readonly registry: ConfigSchemaRegistry;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export interface SetConfigInput {
  readonly key: unknown;
  readonly value: ConfigValue;
}

/**
 * Casos de uso de configuración por tenant (D19).
 *
 * El tenant sale del `ScopeContext` (fail-closed) y **no** del llamador (ADR 0007,
 * punto 4): el caso de uso no puede escribir configuración "para otro tenant", y
 * el puerto no recibe el alcance (§4.1).
 */
export class ConfigService {
  constructor(private readonly dependencies: ConfigServiceDependencies) {}

  async get(key: unknown): Promise<ConfigEntry | null> {
    // Fail-closed explícito en el caso de uso; el adaptador vuelve a exigirlo.
    requireScope();
    return this.dependencies.repository.byKey(normalizeConfigKey(key));
  }

  async set(input: SetConfigInput): Promise<ConfigEntry> {
    const tenantId = requireScope().tenantId;
    const key = normalizeConfigKey(input.key);

    const current = await this.dependencies.repository.byKey(key);
    const next =
      current === null
        ? ConfigEntry.create({
            tenantId,
            key,
            value: input.value,
            registry: this.dependencies.registry,
            clock: this.dependencies.clock,
            idGenerator: this.dependencies.idGenerator,
          })
        : current.replaceValue({
            value: input.value,
            registry: this.dependencies.registry,
            clock: this.dependencies.clock,
            idGenerator: this.dependencies.idGenerator,
          });

    if (next !== current) {
      await this.dependencies.repository.save(next);
    }

    return next;
  }
}