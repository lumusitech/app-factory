import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { PeriodClosing } from '../domain/period-closing.js';
import type { PeriodClosingRepository } from '../domain/period-closing-repository.js';
import { headerParams, rowToSnapshot } from './period-closing-row.js';
import type { PeriodClosingEntryRow, PeriodClosingHeaderRow } from './period-closing-row.js';

/**
 * Adaptador de salida de `PeriodClosingRepository` (D7; ADR 0016).
 *
 * El agregado es la hoja de overrides del curso en un período: cabecera
 * `period_closing` (clave `(curso, período)` + `version`) y filas
 * `period_closing_entry` por (curso, período, alumno). `save` **reemplaza** la hoja
 * completa (borra las entradas y las reinserta) en la **misma** transacción que el
 * outbox (D9/D10).
 */
export class PgPeriodClosingRepository implements PeriodClosingRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byCourseAndPeriod(courseId: string, period: string): Promise<PeriodClosing | null> {
    const header = await this.context.executor.query<PeriodClosingHeaderRow>(
      `SELECT course_id, period, tenant_id, version
         FROM period_closing
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3`,
      [this.context.tenantId, courseId, period],
    );

    const headerRow = header.rows[0];
    if (headerRow === undefined) {
      return null;
    }

    const entries = await this.context.executor.query<PeriodClosingEntryRow>(
      `SELECT student_id, value, motive
         FROM period_closing_entry
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3
        ORDER BY student_id`,
      [this.context.tenantId, courseId, period],
    );

    return PeriodClosing.hydrate(rowToSnapshot(headerRow, entries.rows));
  }

  async save(closing: PeriodClosing): Promise<void> {
    const snapshot = closing.snapshot();

    await this.context.executor.query(
      `INSERT INTO period_closing (course_id, period, tenant_id, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, course_id, period) DO UPDATE SET version = EXCLUDED.version`,
      headerParams(snapshot),
    );

    await this.context.executor.query(
      'DELETE FROM period_closing_entry WHERE tenant_id = $1 AND course_id = $2 AND period = $3',
      [this.context.tenantId, snapshot.courseId, snapshot.period],
    );

    for (const entry of snapshot.entries) {
      await this.context.executor.query(
        `INSERT INTO period_closing_entry (course_id, period, tenant_id, student_id, value, motive)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [snapshot.courseId, snapshot.period, snapshot.tenantId, entry.studentId, entry.value, entry.motive],
      );
    }

    await this.outbox.append(closing.pullEvents());
  }
}
