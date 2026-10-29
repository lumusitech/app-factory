import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { Evaluation } from '../domain/evaluation.js';
import type { EvaluationRepository } from '../domain/evaluation-repository.js';
import { rowToSnapshot, snapshotToParams } from './evaluation-row.js';
import type { EvaluationRow } from './evaluation-row.js';

/**
 * Adaptador de salida de `EvaluationRepository` (D7; ADR 0012).
 *
 * Aplica el **predicado de tenant** desde el `TransactionContext` (que sale del
 * `ScopeContext`; §4.1: el puerto no recibe el alcance) y escribe el outbox en la
 * **misma** transacción (D9/D10).
 */
export class PgEvaluationRepository implements EvaluationRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<Evaluation | null> {
    const { rows } = await this.context.executor.query<EvaluationRow>(
      `SELECT id, tenant_id, course_id, name, period, weight, version
         FROM evaluation
        WHERE tenant_id = $1 AND id = $2`,
      [this.context.tenantId, id],
    );

    const row = rows[0];
    return row === undefined ? null : Evaluation.hydrate(rowToSnapshot(row));
  }

  async save(evaluation: Evaluation): Promise<void> {
    await this.context.executor.query(
      `INSERT INTO evaluation (id, tenant_id, course_id, name, period, weight, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, id) DO UPDATE SET course_id = EXCLUDED.course_id,
                                                 name = EXCLUDED.name,
                                                 period = EXCLUDED.period,
                                                 weight = EXCLUDED.weight,
                                                 version = EXCLUDED.version`,
      snapshotToParams(evaluation.snapshot()),
    );

    await this.outbox.append(evaluation.pullEvents());
  }
}
