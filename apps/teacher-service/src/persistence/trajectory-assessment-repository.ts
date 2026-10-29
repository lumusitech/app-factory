import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { TrajectoryAssessment } from '../domain/trajectory-assessment.js';
import type { TrajectoryAssessmentRepository } from '../domain/trajectory-assessment-repository.js';
import { headerParams, rowToSnapshot } from './trajectory-assessment-row.js';
import type {
  TrajectoryAssessmentEntryRow,
  TrajectoryAssessmentHeaderRow,
} from './trajectory-assessment-row.js';

/**
 * Adaptador de salida de `TrajectoryAssessmentRepository` (D7; ADR 0013).
 *
 * El agregado es la hoja de valoraciones de un curso en un período: cabecera
 * `trajectory_assessment` (clave `(curso, período)` + `version`) y filas
 * `trajectory_assessment_entry` por (curso, período, alumno). `save` **reemplaza**
 * la hoja completa (borra las entradas y las reinserta) en la **misma**
 * transacción que el outbox (D9/D10).
 */
export class PgTrajectoryAssessmentRepository implements TrajectoryAssessmentRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byCourseAndPeriod(courseId: string, period: string): Promise<TrajectoryAssessment | null> {
    const header = await this.context.executor.query<TrajectoryAssessmentHeaderRow>(
      `SELECT course_id, period, tenant_id, version
         FROM trajectory_assessment
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3`,
      [this.context.tenantId, courseId, period],
    );

    const headerRow = header.rows[0];
    if (headerRow === undefined) {
      return null;
    }

    const entries = await this.context.executor.query<TrajectoryAssessmentEntryRow>(
      `SELECT student_id, rating
         FROM trajectory_assessment_entry
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3
        ORDER BY student_id`,
      [this.context.tenantId, courseId, period],
    );

    return TrajectoryAssessment.hydrate(rowToSnapshot(headerRow, entries.rows));
  }

  async save(assessment: TrajectoryAssessment): Promise<void> {
    const snapshot = assessment.snapshot();

    await this.context.executor.query(
      `INSERT INTO trajectory_assessment (course_id, period, tenant_id, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, course_id, period) DO UPDATE SET version = EXCLUDED.version`,
      headerParams(snapshot),
    );

    await this.context.executor.query(
      'DELETE FROM trajectory_assessment_entry WHERE tenant_id = $1 AND course_id = $2 AND period = $3',
      [this.context.tenantId, snapshot.courseId, snapshot.period],
    );

    for (const entry of snapshot.entries) {
      await this.context.executor.query(
        `INSERT INTO trajectory_assessment_entry (course_id, period, tenant_id, student_id, rating)
         VALUES ($1, $2, $3, $4, $5)`,
        [snapshot.courseId, snapshot.period, snapshot.tenantId, entry.studentId, entry.rating],
      );
    }

    await this.outbox.append(assessment.pullEvents());
  }
}
