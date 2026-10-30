import type { TransactionContext } from '@kernel/persistence';

import { ATTENDANCE_STATUSES, type AttendanceStatus } from '../domain/class-attendance.js';
import type { PeriodClosingRecordData } from '../domain/period-closing-view.js';
import { TRAJECTORY_RATINGS, type TrajectoryRating } from '../domain/trajectory-assessment.js';

/**
 * Read model de la planilla de uso diario (ADR 0017).
 *
 * La planilla de uso diario es una **vista derivada** (T6): esto **no** es un
 * agregado ni un repositorio de dominio (D6), sino una **lectura cross-agregado**
 * que reúne, por `(course_id, período)`, la asistencia por fecha (F-01), las
 * actividades y sus notas (F-02), la valoración (F-03), el **cierre** (F-12) y la
 * **evolución** del registro (F-05). El **roster** se deriva de lo capturado
 * (§7.4).
 *
 * El rango de fechas es **opaco** (`from`/`to`, sin hardcodear; §7.8): acota las
 * columnas de asistencia; sin rango, se toman las clases **dictadas** del curso.
 * Como todo acceso a datos de tenant, aplica el **predicado de tenant** desde el
 * `TransactionContext` (§4.1, D11) y corre dentro de la transacción de la unidad
 * de trabajo (con RLS como backstop, D12/scope §9). Las referencias
 * `course_id`/`student_id` son **opacas** hasta que se modelen `Curso`/`Alumno`
 * (ADR 0010).
 */

export interface DailyWorksheetActivityData {
  readonly id: string;
  readonly name: string;
  readonly period: string;
}

export interface DailyWorksheetGradeData {
  readonly evaluationId: string;
  readonly studentId: string;
  readonly value: number;
}

export interface DailyWorksheetTrajectoryData {
  readonly period: string;
  readonly studentId: string;
  readonly rating: TrajectoryRating;
}

export interface DailyWorksheetAttendanceData {
  readonly date: string;
  readonly studentId: string;
  readonly status: AttendanceStatus;
}

export interface DailyWorksheetOverrideData {
  readonly studentId: string;
  readonly value: number;
  readonly motive: string | null;
}

export interface DailyWorksheetData {
  readonly dates: readonly string[];
  readonly roster: readonly string[];
  readonly evaluations: readonly DailyWorksheetActivityData[];
  readonly grades: readonly DailyWorksheetGradeData[];
  readonly trajectory: readonly DailyWorksheetTrajectoryData[];
  readonly attendance: readonly DailyWorksheetAttendanceData[];
  readonly overrides: readonly DailyWorksheetOverrideData[];
  readonly records: readonly PeriodClosingRecordData[];
}

/** Rango de fechas **opaco** de la asistencia (null = sin cota). */
export interface DailyWorksheetDateRange {
  readonly from: string | null;
  readonly to: string | null;
}

export interface DailyWorksheetReadModel {
  byCourseAndPeriod(
    courseId: string,
    period: string,
    range: DailyWorksheetDateRange,
  ): Promise<DailyWorksheetData>;
}

type DateRow = { readonly date: string };
type ActivityRow = { readonly id: string; readonly name: string; readonly period: string };
type GradeRow = {
  readonly evaluation_id: string;
  readonly student_id: string;
  readonly value: number;
};
type TrajectoryRow = {
  readonly period: string;
  readonly student_id: string;
  readonly rating: string;
};
type AttendanceRow = {
  readonly date: string;
  readonly student_id: string;
  readonly status: string;
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

function asTrajectoryRating(value: string): TrajectoryRating {
  if (!(TRAJECTORY_RATINGS as readonly string[]).includes(value)) {
    throw new Error(`Valoración desconocida en la base: "${value}".`);
  }
  return value as TrajectoryRating;
}

function asAttendanceStatus(value: string): AttendanceStatus {
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`Estado de asistencia desconocido en la base: "${value}".`);
  }
  return value as AttendanceStatus;
}

export class PgDailyWorksheetReadModel implements DailyWorksheetReadModel {
  constructor(private readonly context: TransactionContext) {}

  async byCourseAndPeriod(
    courseId: string,
    period: string,
    range: DailyWorksheetDateRange,
  ): Promise<DailyWorksheetData> {
    const tenantId = this.context.tenantId;
    const rangeParams = [tenantId, courseId, range.from, range.to];

    // Fechas de asistencia (columnas): las clases dictadas del curso dentro del
    // rango opaco. `date::text` ordena cronológicamente (ISO 8601).
    const dates = await this.context.executor.query<DateRow>(
      `SELECT DISTINCT cs.date::text AS date
         FROM class_session cs
        WHERE cs.tenant_id = $1 AND cs.course_id = $2 AND cs.status = 'dictada'
          AND ($3::date IS NULL OR cs.date >= $3::date)
          AND ($4::date IS NULL OR cs.date <= $4::date)
        ORDER BY date`,
      rangeParams,
    );

    const evaluations = await this.context.executor.query<ActivityRow>(
      `SELECT id, name, period FROM evaluation
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3
        ORDER BY name, id`,
      [tenantId, courseId, period],
    );

    const grades = await this.context.executor.query<GradeRow>(
      `SELECT ge.evaluation_id, ge.student_id, ge.value
         FROM grade_entry ge
         JOIN evaluation e ON e.tenant_id = ge.tenant_id AND e.id = ge.evaluation_id
        WHERE ge.tenant_id = $1 AND e.course_id = $2 AND e.period = $3`,
      [tenantId, courseId, period],
    );

    const trajectory = await this.context.executor.query<TrajectoryRow>(
      `SELECT period, student_id, rating FROM trajectory_assessment_entry
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3`,
      [tenantId, courseId, period],
    );

    const attendance = await this.context.executor.query<AttendanceRow>(
      `SELECT cs.date::text AS date, ae.student_id, ae.status
         FROM attendance_entry ae
         JOIN class_session cs ON cs.tenant_id = ae.tenant_id AND cs.id = ae.class_session_id
        WHERE ae.tenant_id = $1 AND cs.course_id = $2
          AND ($3::date IS NULL OR cs.date >= $3::date)
          AND ($4::date IS NULL OR cs.date <= $4::date)
        ORDER BY cs.date, ae.student_id`,
      rangeParams,
    );

    const overrides = await this.context.executor.query<OverrideRow>(
      `SELECT student_id, value, motive FROM period_closing_entry
        WHERE tenant_id = $1 AND course_id = $2 AND period = $3`,
      [tenantId, courseId, period],
    );

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
    for (const entry of attendance.rows) {
      roster.add(entry.student_id);
    }
    for (const entry of trajectory.rows) {
      roster.add(entry.student_id);
    }
    for (const override of overrides.rows) {
      roster.add(override.student_id);
    }
    for (const record of records.rows) {
      roster.add(record.student_id);
    }

    return {
      dates: dates.rows.map((row) => row.date),
      roster: [...roster],
      evaluations: evaluations.rows.map((row) => ({
        id: row.id,
        name: row.name,
        period: row.period,
      })),
      grades: grades.rows.map((row) => ({
        evaluationId: row.evaluation_id,
        studentId: row.student_id,
        value: row.value,
      })),
      trajectory: trajectory.rows.map((row) => ({
        period: row.period,
        studentId: row.student_id,
        rating: asTrajectoryRating(row.rating),
      })),
      attendance: attendance.rows.map((row) => ({
        date: row.date,
        studentId: row.student_id,
        status: asAttendanceStatus(row.status),
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
