import type { TransactionContext } from '@kernel/persistence';

import { ATTENDANCE_STATUSES, type AttendanceStatus } from '../domain/class-attendance.js';
import { TRAJECTORY_RATINGS, type TrajectoryRating } from '../domain/trajectory-assessment.js';

/**
 * Read model de la planilla (F-04; ADR 0014).
 *
 * La planilla es una **vista derivada** (T6): esto **no** es un agregado ni un
 * repositorio de dominio (D6), sino una **lectura cross-agregado** que reúne, por
 * `course_id`, las notas (F-02), las valoraciones (F-03), las asistencias (F-01) y
 * el **roster** derivado (unión de los `student_id` capturados; §7.4).
 *
 * Como todo acceso a datos de tenant, aplica el **predicado de tenant** desde el
 * `TransactionContext` (§4.1, D11) y corre dentro de la transacción de la unidad
 * de trabajo (con RLS como backstop, D12/scope §9). Las referencias
 * `course_id`/`student_id` son **opacas** hasta que se modelen `Curso`/`Alumno`
 * (ADR 0010/0013).
 */

export interface OfficialSheetEvaluationData {
  readonly id: string;
  readonly period: string;
  readonly weight: number;
}

export interface OfficialSheetGradeData {
  readonly evaluationId: string;
  readonly studentId: string;
  readonly value: number;
}

export interface OfficialSheetTrajectoryData {
  readonly period: string;
  readonly studentId: string;
  readonly rating: TrajectoryRating;
}

export interface OfficialSheetAttendanceData {
  readonly studentId: string;
  readonly status: AttendanceStatus;
}

export interface OfficialSheetData {
  readonly roster: readonly string[];
  readonly evaluations: readonly OfficialSheetEvaluationData[];
  readonly grades: readonly OfficialSheetGradeData[];
  readonly trajectory: readonly OfficialSheetTrajectoryData[];
  readonly attendance: readonly OfficialSheetAttendanceData[];
}

export interface OfficialSheetReadModel {
  byCourse(courseId: string): Promise<OfficialSheetData>;
}

type RosterRow = { readonly student_id: string };
type EvaluationRow = {
  readonly id: string;
  readonly period: string;
  readonly weight: string | number;
};
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
  readonly student_id: string;
  readonly status: string;
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

export class PgOfficialSheetReadModel implements OfficialSheetReadModel {
  constructor(private readonly context: TransactionContext) {}

  async byCourse(courseId: string): Promise<OfficialSheetData> {
    const tenantId = this.context.tenantId;

    // Roster derivado: unión de los alumnos con nota, valoración o asistencia del
    // curso. Sin `student` modelado, el legajo (§7.4) es la única identidad.
    const roster = await this.context.executor.query<RosterRow>(
      `SELECT student_id FROM grade_entry ge
         JOIN evaluation e ON e.tenant_id = ge.tenant_id AND e.id = ge.evaluation_id
        WHERE ge.tenant_id = $1 AND e.course_id = $2
        UNION
       SELECT student_id FROM trajectory_assessment_entry te
        WHERE te.tenant_id = $1 AND te.course_id = $2
        UNION
       SELECT ae.student_id FROM attendance_entry ae
         JOIN class_session cs ON cs.tenant_id = ae.tenant_id AND cs.id = ae.class_session_id
        WHERE ae.tenant_id = $1 AND cs.course_id = $2`,
      [tenantId, courseId],
    );

    const evaluations = await this.context.executor.query<EvaluationRow>(
      `SELECT id, period, weight FROM evaluation WHERE tenant_id = $1 AND course_id = $2`,
      [tenantId, courseId],
    );

    const grades = await this.context.executor.query<GradeRow>(
      `SELECT ge.evaluation_id, ge.student_id, ge.value
         FROM grade_entry ge
         JOIN evaluation e ON e.tenant_id = ge.tenant_id AND e.id = ge.evaluation_id
        WHERE ge.tenant_id = $1 AND e.course_id = $2`,
      [tenantId, courseId],
    );

    const trajectory = await this.context.executor.query<TrajectoryRow>(
      `SELECT period, student_id, rating FROM trajectory_assessment_entry
        WHERE tenant_id = $1 AND course_id = $2`,
      [tenantId, courseId],
    );

    const attendance = await this.context.executor.query<AttendanceRow>(
      `SELECT ae.student_id, ae.status
         FROM attendance_entry ae
         JOIN class_session cs ON cs.tenant_id = ae.tenant_id AND cs.id = ae.class_session_id
        WHERE ae.tenant_id = $1 AND cs.course_id = $2`,
      [tenantId, courseId],
    );

    return {
      roster: roster.rows.map((row) => row.student_id),
      evaluations: evaluations.rows.map((row) => ({
        id: row.id,
        period: row.period,
        weight: Number(row.weight),
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
        studentId: row.student_id,
        status: asAttendanceStatus(row.status),
      })),
    };
  }
}
