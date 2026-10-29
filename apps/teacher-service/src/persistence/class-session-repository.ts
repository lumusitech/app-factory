import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { ClassSession } from '../domain/class-session.js';
import type { ClassSessionRepository } from '../domain/class-session-repository.js';
import { rowToSnapshot, snapshotToParams } from './class-session-row.js';
import type { ClassSessionRow } from './class-session-row.js';

/**
 * Adaptador de salida de `ClassSessionRepository` (D7; ADR 0010).
 *
 * Aplica el **predicado de tenant** desde el `TransactionContext` (que sale del
 * `ScopeContext`; §4.1: el puerto no recibe el alcance) y escribe el outbox en la
 * **misma** transacción que el agregado (D9/D10). La tabla y su RLS son de la
 * vertical (`teacher-service`; `evolution.md` §3).
 */
export class PgClassSessionRepository implements ClassSessionRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<ClassSession | null> {
    const { rows } = await this.context.executor.query<ClassSessionRow>(
      `SELECT id, tenant_id, course_id, date::text AS date, status, cancellation_reason, version
         FROM class_session
        WHERE tenant_id = $1 AND id = $2`,
      [this.context.tenantId, id],
    );

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    return ClassSession.hydrate(rowToSnapshot(row));
  }

  async save(session: ClassSession): Promise<void> {
    await this.context.executor.query(
      `INSERT INTO class_session (id, tenant_id, course_id, date, status, cancellation_reason, version)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET course_id = EXCLUDED.course_id,
                                      date = EXCLUDED.date,
                                      status = EXCLUDED.status,
                                      cancellation_reason = EXCLUDED.cancellation_reason,
                                      version = EXCLUDED.version`,
      snapshotToParams(session.snapshot()),
    );

    await this.outbox.append(session.pullEvents());
  }
}
