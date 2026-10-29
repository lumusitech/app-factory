import type { TrajectoryAssessmentSnapshot, TrajectoryRating } from '../domain/trajectory-assessment.js';

/** Fila de la cabecera de `trajectory_assessment` (clave (curso, período) + token de versión). */
export type TrajectoryAssessmentHeaderRow = {
  readonly course_id: string;
  readonly period: string;
  readonly tenant_id: string;
  readonly version: number;
};

/** Fila de `trajectory_assessment_entry` (una por alumno del curso en el período). */
export type TrajectoryAssessmentEntryRow = {
  readonly student_id: string;
  readonly rating: string;
};

/** Mapper **explícito** cabecera + entradas → snapshot (D7). */
export function rowToSnapshot(
  header: TrajectoryAssessmentHeaderRow,
  entries: readonly TrajectoryAssessmentEntryRow[],
): TrajectoryAssessmentSnapshot {
  return {
    courseId: header.course_id,
    period: header.period,
    tenantId: header.tenant_id,
    entries: entries.map((entry) => ({
      studentId: entry.student_id,
      rating: entry.rating as TrajectoryRating,
    })),
    version: header.version,
  };
}

/** Parámetros de la cabecera del `INSERT`/`UPDATE`, en orden (D7). */
export function headerParams(snapshot: TrajectoryAssessmentSnapshot): readonly unknown[] {
  return [snapshot.courseId, snapshot.period, snapshot.tenantId, snapshot.version];
}
