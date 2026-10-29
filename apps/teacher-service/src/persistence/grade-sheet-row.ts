import type { GradeSheetSnapshot } from '../domain/grade-sheet.js';

/** Fila de la cabecera de `grade_sheet` (identidad + token de versión). */
export type GradeSheetHeaderRow = {
  readonly evaluation_id: string;
  readonly tenant_id: string;
  readonly version: number;
};

/** Fila de `grade_entry` (una por alumno de la evaluación). */
export type GradeEntryRow = {
  readonly student_id: string;
  readonly value: number;
};

/** Mapper **explícito** cabecera + entradas → snapshot (D7). */
export function rowToSnapshot(
  header: GradeSheetHeaderRow,
  entries: readonly GradeEntryRow[],
): GradeSheetSnapshot {
  return {
    evaluationId: header.evaluation_id,
    tenantId: header.tenant_id,
    entries: entries.map((entry) => ({
      studentId: entry.student_id,
      value: Number(entry.value),
    })),
    version: header.version,
  };
}

/** Parámetros de la cabecera del `INSERT`/`UPDATE`, en orden (D7). */
export function headerParams(snapshot: GradeSheetSnapshot): readonly unknown[] {
  return [snapshot.evaluationId, snapshot.tenantId, snapshot.version];
}
