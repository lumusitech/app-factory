import { ATTENDANCE_STATUSES, type AttendanceStatus } from './class-attendance.js';
import type { TrajectoryRating } from './trajectory-assessment.js';

/**
 * Planilla oficial como **vista derivada** (F-04; `docs/teacher-service-context.md`
 * §3.5, T6; ADR 0014).
 *
 * La planilla **no** se persiste: se deriva, en memoria, de las notas (F-02), las
 * valoraciones (F-03) y las asistencias (F-01). Esta capa es **pura** (sin
 * frameworks, D5): produce una **vista neutra** que la plantilla mapea a columnas.
 *
 * La nota del período es el **promedio ponderado** de las evaluaciones del
 * período (peso = `Evaluation.weight`; ADR 0012 punto 3), redondeado a entero
 * half-up (escala 1–10, T16). `studentId` es el **legajo** (§7.4): la vista ordena
 * por legajo, nunca por posición. Ninguna fecha, ventana ni umbral se hardcodea
 * (§7.8): la vista expone valores, no condiciones de aprobación.
 */

/** Celda de un período: nota derivada (o `null`) y valoración preliminar (o `null`). */
export interface OfficialSheetPeriodValue {
  readonly period: string;
  readonly grade: number | null;
  readonly trajectory: TrajectoryRating | null;
}

/** Fila por alumno (legajo; §7.4). */
export interface OfficialSheetStudentRow {
  readonly studentId: string;
  readonly periods: readonly OfficialSheetPeriodValue[];
  readonly attendance: Readonly<Record<AttendanceStatus, number>>;
}

/** Vista derivada de la planilla, lista para que la plantilla la mapee. */
export interface OfficialSheetView {
  readonly courseId: string;
  readonly periods: readonly string[];
  readonly students: readonly OfficialSheetStudentRow[];
}

export interface OfficialSheetEvaluationInput {
  readonly id: string;
  readonly period: string;
  readonly weight: number;
}

export interface OfficialSheetGradeInput {
  readonly evaluationId: string;
  readonly studentId: string;
  readonly value: number;
}

export interface OfficialSheetTrajectoryInput {
  readonly period: string;
  readonly studentId: string;
  readonly rating: TrajectoryRating;
}

export interface OfficialSheetAttendanceInput {
  readonly studentId: string;
  readonly status: AttendanceStatus;
}

export interface OfficialSheetBuildInput {
  readonly courseId: string;
  readonly periods: readonly string[];
  readonly roster: readonly string[];
  readonly evaluations: readonly OfficialSheetEvaluationInput[];
  readonly grades: readonly OfficialSheetGradeInput[];
  readonly trajectory: readonly OfficialSheetTrajectoryInput[];
  readonly attendance: readonly OfficialSheetAttendanceInput[];
}

function pairKey(first: string, second: string): string {
  return `${first}\u0000${second}`;
}

function emptyAttendanceCounts(): Record<AttendanceStatus, number> {
  const counts = {} as Record<AttendanceStatus, number>;
  for (const status of ATTENDANCE_STATUSES) {
    counts[status] = 0;
  }
  return counts;
}

/** Redondeo medio-arriba (half-up) a entero, para la escala entera 1–10 (T16). */
export function roundHalfUp(value: number): number {
  return Math.round(value);
}

/**
 * Promedio ponderado de las evaluaciones del período que tienen **nota del
 * alumno** (las evaluaciones sin nota no arrastran). Sin evaluaciones con nota,
 * devuelve `null` (celda vacía; nunca 0).
 */
export function weightedPeriodGrade(
  period: string,
  studentId: string,
  evaluationsByPeriod: ReadonlyMap<string, readonly OfficialSheetEvaluationInput[]>,
  gradeByEvaluationStudent: ReadonlyMap<string, number>,
): number | null {
  const evaluations = evaluationsByPeriod.get(period) ?? [];
  let weightSum = 0;
  let weightedSum = 0;
  for (const evaluation of evaluations) {
    const value = gradeByEvaluationStudent.get(pairKey(evaluation.id, studentId));
    if (value === undefined) {
      continue;
    }
    weightSum += evaluation.weight;
    weightedSum += evaluation.weight * value;
  }
  if (weightSum <= 0) {
    return null;
  }
  return roundHalfUp(weightedSum / weightSum);
}

/** Construye la vista derivada de la planilla (pura, determinista). */
export function buildOfficialSheet(input: OfficialSheetBuildInput): OfficialSheetView {
  const roster = [...new Set(input.roster)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const evaluationsByPeriod = new Map<string, OfficialSheetEvaluationInput[]>();
  for (const evaluation of input.evaluations) {
    const list = evaluationsByPeriod.get(evaluation.period);
    if (list === undefined) {
      evaluationsByPeriod.set(evaluation.period, [evaluation]);
    } else {
      list.push(evaluation);
    }
  }

  const gradeByEvaluationStudent = new Map<string, number>();
  for (const grade of input.grades) {
    gradeByEvaluationStudent.set(pairKey(grade.evaluationId, grade.studentId), grade.value);
  }

  const trajectoryByPeriodStudent = new Map<string, TrajectoryRating>();
  for (const entry of input.trajectory) {
    trajectoryByPeriodStudent.set(pairKey(entry.period, entry.studentId), entry.rating);
  }

  const attendanceByStudent = new Map<string, Record<AttendanceStatus, number>>();
  for (const entry of input.attendance) {
    let counts = attendanceByStudent.get(entry.studentId);
    if (counts === undefined) {
      counts = emptyAttendanceCounts();
      attendanceByStudent.set(entry.studentId, counts);
    }
    counts[entry.status] += 1;
  }

  const students = roster.map(
    (studentId): OfficialSheetStudentRow => ({
      studentId,
      periods: input.periods.map(
        (period): OfficialSheetPeriodValue => ({
          period,
          grade: weightedPeriodGrade(
            period,
            studentId,
            evaluationsByPeriod,
            gradeByEvaluationStudent,
          ),
          trajectory: trajectoryByPeriodStudent.get(pairKey(period, studentId)) ?? null,
        }),
      ),
      attendance: attendanceByStudent.get(studentId) ?? emptyAttendanceCounts(),
    }),
  );

  return { courseId: input.courseId, periods: [...input.periods], students };
}
