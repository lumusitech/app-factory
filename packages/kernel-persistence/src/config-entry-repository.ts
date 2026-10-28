import type { ConfigEntry, ConfigEntryRepository, ConfigValue } from '@kernel/config';
import { ConfigEntry as ConfigEntryValue } from '@kernel/config';
import type { OutboxPort } from '@kernel/domain';

import type { TransactionContext } from './unit-of-work.js';

type ConfigRow = {
  readonly tenant_id: string;
  readonly key: string;
  readonly value: ConfigValue;
  readonly schema_version: number;
  readonly updated_at: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Adaptador de salida de `ConfigEntryRepository` (ADR 0007).
 *
 * Aplica el **predicado de tenant** desde el `TransactionContext` (que sale del
 * `ScopeContext`; §4.1: el puerto no recibe el alcance) y escribe el outbox en la
 * **misma** transacción que la entrada (D9/D10). La tabla y su RLS son del esquema
 * del kernel (`kernel-persistence`, D13).
 */
export class PgConfigEntryRepository implements ConfigEntryRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byKey(key: string): Promise<ConfigEntry | null> {
    const { rows } = await this.context.executor.query<ConfigRow>(
      `SELECT tenant_id, key, value, schema_version, updated_at
         FROM config_entry
        WHERE tenant_id = $1 AND key = $2`,
      [this.context.tenantId, key],
    );

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    return ConfigEntryValue.hydrate({
      tenantId: row.tenant_id,
      key: row.key,
      value: row.value,
      schemaVersion: row.schema_version,
      updatedAt: toDate(row.updated_at),
    });
  }

  async save(entry: ConfigEntry): Promise<void> {
    const snapshot = entry.snapshot();

    await this.context.executor.query(
      `INSERT INTO config_entry (tenant_id, key, value, schema_version, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (tenant_id, key)
       DO UPDATE SET value = EXCLUDED.value,
                     schema_version = EXCLUDED.schema_version,
                     updated_at = EXCLUDED.updated_at`,
      [
        snapshot.tenantId,
        snapshot.key,
        JSON.stringify(snapshot.value),
        snapshot.schemaVersion,
        snapshot.updatedAt,
      ],
    );

    await this.outbox.append(entry.pullEvents());
  }
}