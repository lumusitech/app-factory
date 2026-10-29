import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { Assignment } from '../domain/assignment.js';
import type { AssignmentRepository } from '../domain/assignment-repository.js';
import { rowToSnapshot, snapshotToParams } from './assignment-row.js';
import type { AssignmentRow } from './assignment-row.js';

/**
 * Adaptador de salida de `AssignmentRepository` (D7; ADR 0011). Predicado de
 * tenant desde el `TransactionContext` y outbox en la **misma** transacción.
 */
export class PgAssignmentRepository implements AssignmentRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<Assignment | null> {
    const { rows } = await this.context.executor.query<AssignmentRow>(
      `SELECT id, tenant_id, class_session_id, topic_id, content, version
         FROM assignment
        WHERE tenant_id = $1 AND id = $2`,
      [this.context.tenantId, id],
    );

    const row = rows[0];
    return row === undefined ? null : Assignment.hydrate(rowToSnapshot(row));
  }

  async save(assignment: Assignment): Promise<void> {
    await this.context.executor.query(
      `INSERT INTO assignment (id, tenant_id, class_session_id, topic_id, content, version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET class_session_id = EXCLUDED.class_session_id,
                                      topic_id = EXCLUDED.topic_id,
                                      content = EXCLUDED.content,
                                      version = EXCLUDED.version`,
      snapshotToParams(assignment.snapshot()),
    );

    await this.outbox.append(assignment.pullEvents());
  }
}
