import type { TransactionContext } from '@kernel/persistence';

import type {
  PeriodClosingEvaluationData,
  PeriodClosingGradeData,
  PeriodClosingOverrideData,
  PeriodClosingRecordData,
} from '../domain/period-closing-view.js';

/**
 * Read model del cierre de período (F-12; ADR 0016).
 *
 * El cierre es una **vista derivada** (T6): esto **no** es un agregado ni un
 * repositorio de dominio (D6), sino una **lectura cross-agregado** que reúne, por
 * `(course_id, periodo)`, las evaluaciones y sus notas vigentes (F-02), los
 * overrides manuales (agregado `PeriodClosing`) y la **evolución** del registro
 * (entradas `evaluacion` de `StudentRecord`, F-05). El **roster** se deriva de lo
 * capturado (unión de alumnos con nota, override o evolución; §7.4).
 *
 * Como todo acceso a datos de tenant, aplica el **predicado de tenant** desde el
 * `TransactionContext` (§4.1, D11) y corre dentro de la transacción de la unidad
 * de trabajo (con RLS como backstop, D12/scope §9). Las referencias
 * `course_id`/`student_id` son **opacas** hasta que se modelen `Curso`/`Alumno`
 * (ADR 0010).
 */

export interface PeriodClosingData {
  readonly roster: readonly string[];
  readonly evaluations: readonly PeriodClosingEvaluationData[];
  readonly grades: readonly PeriodClosingGradeData[];
  readonly overrides: readonly PeriodClosingOverrideData[];
  readonly records: readonly PeriodClosingRecordData[];
}

export interface PeriodClosingReadModel {
  byCourseAndPeriod(courseId: string, period: string): Promise<PeriodClosingData>;
}

type EvaluationRow = { readonly id: string; readonly period: string };
type GradeRow = {
  readonly evaluation_id: string;
  readonly student_id: string;
  readonly value: number;
};
type OverrideRow = {
  readonly student_id: string;
  readonly value: number;
  readonly motive: string | null;
};
type RecordRow = {
  readonly student_id: string;
  readonly evaluation_id: string;
  readonly grade: number | null;
  readonly note: string | null;
  readonly occurred_on: string;
};

export class PgPeriodClosingReadModel implements PeriodClosingReadModel {
  constructor(private readonly context: TransactionContext) {}

  async byCourseAndPeriod(courseId: string, period: string): Promise<PeriodClosingData> {
    const tenantId = this.context.tenantId;

    const evaluations = await this.context.executor.query<EvaluationRow>(
      `SELECT id, period FROM evaluation
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3`,
      [tenantId, courseId, period],
    );

    const grades = await this.context.executor.query<GradeRow>(
      `SELECT ge.evaluation_id, ge.student_id, ge.value
         FROM grade_entry ge
         JOIN evaluation e ON e.tenant_id = ge.tenant_id AND e.id = ge.evaluation_id
        WHERE ge.tenant_id = $1 AND e.course_id = $2 AND e.period = $3`,
      [tenantId, courseId, period],
    );

    const overrides = await this.context.executor.query<OverrideRow>(
      `SELECT student_id, value, motive
         FROM period_closing_entry
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3`,
      [tenantId, courseId, period],
    );

    // Evolución: entradas `evaluacion` del registro de los trabajos del período,
    // ordenadas por fecha e inserción (`id`) para que "la última nota manda" sea
    // determinista (ADR 0015 §5).
    const records = await this.context.executor.query<RecordRow>(
      `SELECT sr.student_id, sr.evaluation_id, sr.grade, sr.note, sr.occurred_on::text AS occurred_on
         FROM student_record sr
         JOIN evaluation e ON e.tenant_id = sr.tenant_id AND e.id = sr.evaluation_id
        WHERE sr.tenant_id = $1 AND sr.kind = 'evaluacion' AND e.course_id = $2 AND e.period = $3
        ORDER BY sr.occurred_on, sr.id`,
      [tenantId, courseId, period],
    );

    const roster = new Set<string>();
    for (const grade of grades.rows) {
      roster.add(grade.student_id);
    }
    for (const override of overrides.rows) {
      roster.add(override.student_id);
    }
    for (const record of records.rows) {
      roster.add(record.student_id);
    }

    return {
      roster: [...roster],
      evaluations: evaluations.rows.map((row) => ({ id: row.id, period: row.period })),
      grades: grades.rows.map((row) => ({
        evaluationId: row.evaluation_id,
        studentId: row.student_id,
        value: row.value,
      })),
      overrides: overrides.rows.map((row) => ({
        studentId: row.student_id,
        value: row.value,
        motive: row.motive,
      })),
      records: records.rows.map((row) => ({
        studentId: row.student_id,
        evaluationId: row.evaluation_id,
        grade: row.grade,
        note: row.note,
        occurredOn: row.occurred_on,
      })),
    };
  }
}
