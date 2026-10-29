import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { GradeSheet } from '../domain/grade-sheet.js';
import type { GradeSheetRepository } from '../domain/grade-sheet-repository.js';
import { headerParams, rowToSnapshot } from './grade-sheet-row.js';
import type { GradeEntryRow, GradeSheetHeaderRow } from './grade-sheet-row.js';

/**
 * Adaptador de salida de `GradeSheetRepository` (D7; ADR 0012).
 *
 * El agregado es la hoja de notas de la evaluación: cabecera `grade_sheet`
 * (identidad + `version`) y filas `grade_entry` por (evaluación, alumno). `save`
 * **reemplaza** la hoja completa (borra las entradas y las reinserta) en la
 * **misma** transacción que el outbox (D9/D10).
 */
export class PgGradeSheetRepository implements GradeSheetRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byEvaluationId(evaluationId: string): Promise<GradeSheet | null> {
    const header = await this.context.executor.query<GradeSheetHeaderRow>(
      `SELECT evaluation_id, tenant_id, version
         FROM grade_sheet
        WHERE tenant_id = $1 AND evaluation_id = $2`,
      [this.context.tenantId, evaluationId],
    );

    const headerRow = header.rows[0];
    if (headerRow === undefined) {
      return null;
    }

    const entries = await this.context.executor.query<GradeEntryRow>(
      `SELECT student_id, value
         FROM grade_entry
        WHERE tenant_id = $1 AND evaluation_id = $2
        ORDER BY student_id`,
      [this.context.tenantId, evaluationId],
    );

    return GradeSheet.hydrate(rowToSnapshot(headerRow, entries.rows));
  }

  async save(sheet: GradeSheet): Promise<void> {
    const snapshot = sheet.snapshot();

    await this.context.executor.query(
      `INSERT INTO grade_sheet (evaluation_id, tenant_id, version)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, evaluation_id) DO UPDATE SET version = EXCLUDED.version`,
      headerParams(snapshot),
    );

    await this.context.executor.query(
      'DELETE FROM grade_entry WHERE tenant_id = $1 AND evaluation_id = $2',
      [this.context.tenantId, snapshot.evaluationId],
    );

    for (const entry of snapshot.entries) {
      await this.context.executor.query(
        `INSERT INTO grade_entry (evaluation_id, tenant_id, student_id, value)
         VALUES ($1, $2, $3, $4)`,
        [snapshot.evaluationId, snapshot.tenantId, entry.studentId, entry.value],
      );
    }

    await this.outbox.append(sheet.pullEvents());
  }
}
