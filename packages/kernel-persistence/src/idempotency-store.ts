import type { IdempotencyRecord, IdempotencyStore } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';
import { requireScope } from '@kernel/scope';

import type { SqlConnection } from './executor.js';
import { setTenantSetting } from './unit-of-work.js';

type IdempotencyRow = {
  readonly key: string;
  readonly fingerprint: string;
  readonly status_code: number;
  readonly body: unknown;
  readonly created_at: Date | string;
  readonly expires_at: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Store de idempotencia sobre SQL (contrato de idempotencia §12; ADR 0006).
 *
 * Cada operación corre en su propia transacción y fija `app.tenant_id` desde el
 * `ScopeContext` (fail-closed: sin alcance lanza) para que el backstop RLS (D12)
 * aplique. `find` respeta el TTL de 48 h (§4): un registro vencido se trata como
 * inexistente.
 */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly connection: SqlConnection,
    private readonly clock: Clock,
  ) {}

  async find(key: string): Promise<IdempotencyRecord | null> {
    const tenantId = requireScope().tenantId;

    return this.connection.transaction(async (tx) => {
      await setTenantSetting(tx, tenantId);

      const { rows } = await tx.query<IdempotencyRow>(
        `SELECT key, fingerprint, status_code, body, created_at, expires_at
           FROM idempotency_record
          WHERE tenant_id = $1 AND key = $2 AND expires_at > $3`,
        [tenantId, key, this.clock.now()],
      );

      const row = rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        key: row.key,
        fingerprint: row.fingerprint,
        statusCode: row.status_code,
        body: row.body,
        createdAt: toDate(row.created_at),
        expiresAt: toDate(row.expires_at),
      };
    });
  }

  async save(record: IdempotencyRecord): Promise<void> {
    const tenantId = requireScope().tenantId;

    await this.connection.transaction(async (tx) => {
      await setTenantSetting(tx, tenantId);

      await tx.query(
        `INSERT INTO idempotency_record (tenant_id, key, fingerprint, status_code, body, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        [
          tenantId,
          record.key,
          record.fingerprint,
          record.statusCode,
          JSON.stringify(record.body ?? null),
          record.createdAt,
          record.expiresAt,
        ],
      );
    });
  }
}