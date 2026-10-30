import type { AttendanceStatus } from './class-attendance.js';
import {
  buildPeriodClosing,
  type ClosingState,
  type PeriodClosingEvolutionEntry,
  type PeriodClosingRecordData,
} from './period-closing-view.js';
import type { TrajectoryRating } from './trajectory-assessment.js';

/**
 * Planilla de uso diario como **vista derivada** (ADR 0017;
 * `docs/teacher-service-context.md` §3.5, T6).
 *
 * La hoja de trabajo del docente **no** se persiste: se deriva, en memoria, de la
 * asistencia por fecha (F-01), las actividades/notas del período (F-02), la
 * valoración TEA/TEP/TED (F-03), el **cierre de período** (F-12, ADR 0016) y la
 * **evolución** del registro (F-05, ADR 0015). Esta capa es **pura** (sin
 * frameworks, D5): produce una **vista neutra** que la plantilla mapea.
 *
 * El `studentId` es el **legajo** (§7.4): la vista ordena por legajo, nunca por
 * posición. Ninguna fecha, ventana ni umbral se hardcodea (§7.8): la vista expone
 * valores, no condiciones de aprobación. La **condición** (aprobado ≥7 /
 * intensificación ≥4) queda **diferida** (T16, §7.8/§7.9; ADR 0016 punto 8).
 */

/** Columna de actividad: trabajo del período (nombre visible + `evaluationId`). */
export interface DailyWorksheetActivity {
  readonly evaluationId: string;
  readonly name: string;
}

/** Cierre del período del alumno (reusa F-12; ADR 0016). */
export interface DailyWorksheetClosing {
  readonly automatic: number | null;
  readonly effective: number | null;
  readonly state: ClosingState;
  readonly motive: string | null;
}

/** Fila por alumno (legajo; §7.4). */
export interface DailyWorksheetStudentRow {
  readonly studentId: string;
  /** Asistencia por fecha (`date` → estado); las fechas sin captura no aparecen. */
  readonly attendance: Readonly<Record<string, AttendanceStatus>>;
  /** Nota por actividad (`evaluationId` → valor); sin nota, la clave no existe. */
  readonly grades: Readonly<Record<string, number>>;
  readonly trajectory: TrajectoryRating | null;
  readonly closing: DailyWorksheetClosing;
  readonly evolution: readonly PeriodClosingEvolutionEntry[];
}

/** Vista derivada de la planilla de uso diario, lista para que la plantilla la mapee. */
export interface DailyWorksheetView {
  readonly courseId: string;
  readonly period: string;
  readonly dates: readonly string[];
  readonly activities: readonly DailyWorksheetActivity[];
  readonly students: readonly DailyWorksheetStudentRow[];
}

export interface DailyWorksheetEvaluationInput {
  readonly id: string;
  readonly name: string;
  readonly period: string;
}

export interface DailyWorksheetGradeInput {
  readonly evaluationId: string;
  readonly studentId: string;
  readonly value: number;
}

export interface DailyWorksheetTrajectoryInput {
  readonly period: string;
  readonly studentId: string;
  readonly rating: TrajectoryRating;
}

export interface DailyWorksheetAttendanceInput {
  readonly date: string;
  readonly studentId: string;
  readonly status: AttendanceStatus;
}

export interface DailyWorksheetOverrideInput {
  readonly studentId: string;
  readonly value: number;
  readonly motive: string | null;
}

export interface DailyWorksheetBuildInput {
  readonly courseId: string;
  readonly period: string;
  readonly dates: readonly string[];
  readonly roster: readonly string[];
  readonly evaluations: readonly DailyWorksheetEvaluationInput[];
  readonly grades: readonly DailyWorksheetGradeInput[];
  readonly trajectory: readonly DailyWorksheetTrajectoryInput[];
  readonly attendance: readonly DailyWorksheetAttendanceInput[];
  readonly overrides: readonly DailyWorksheetOverrideInput[];
  readonly records: readonly PeriodClosingRecordData[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

/** Construye la vista derivada de la planilla de uso diario (pura, determinista). */
export function buildDailyWorksheet(input: DailyWorksheetBuildInput): DailyWorksheetView {
  const dates = sortedUnique(input.dates);
  const roster = sortedUnique(input.roster);

  const activities = input.evaluations
    .filter((evaluation) => evaluation.period === input.period)
    .map((evaluation): DailyWorksheetActivity => ({
      evaluationId: evaluation.id,
      name: evaluation.name,
    }))
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.evaluationId, b.evaluationId));
  const activityIds = new Set(activities.map((activity) => activity.evaluationId));

  const gradesByStudent = new Map<string, Record<string, number>>();
  for (const grade of input.grades) {
    if (!activityIds.has(grade.evaluationId)) {
      continue;
    }
    let grades = gradesByStudent.get(grade.studentId);
    if (grades === undefined) {
      grades = {};
      gradesByStudent.set(grade.studentId, grades);
    }
    grades[grade.evaluationId] = grade.value;
  }

  const attendanceByStudent = new Map<string, Record<string, AttendanceStatus>>();
  for (const entry of input.attendance) {
    let attendance = attendanceByStudent.get(entry.studentId);
    if (attendance === undefined) {
      attendance = {};
      attendanceByStudent.set(entry.studentId, attendance);
    }
    attendance[entry.date] = entry.status;
  }

  const trajectoryByStudent = new Map<string, TrajectoryRating>();
  for (const entry of input.trajectory) {
    if (entry.period === input.period) {
      trajectoryByStudent.set(entry.studentId, entry.rating);
    }
  }

  const closing = buildPeriodClosing({
    courseId: input.courseId,
    period: input.period,
    roster,
    evaluations: input.evaluations.map((evaluation) => ({
      id: evaluation.id,
      period: evaluation.period,
    })),
    grades: input.grades,
    overrides: input.overrides,
    records: input.records,
  });
  const closingByStudent = new Map(closing.students.map((student) => [student.studentId, student]));

  const students = roster.map((studentId): DailyWorksheetStudentRow => {
    const closingRow = closingByStudent.get(studentId);
    return {
      studentId,
      attendance: attendanceByStudent.get(studentId) ?? {},
      grades: gradesByStudent.get(studentId) ?? {},
      trajectory: trajectoryByStudent.get(studentId) ?? null,
      closing: {
        automatic: closingRow?.automatic ?? null,
        effective: closingRow?.effective ?? null,
        state: closingRow?.state ?? 'automatica',
        motive: closingRow?.motive ?? null,
      },
      evolution: closingRow?.evolution ?? [],
    };
  });

  return { courseId: input.courseId, period: input.period, dates, activities, students };
}
