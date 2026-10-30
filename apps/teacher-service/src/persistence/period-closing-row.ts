import type { PeriodClosingSnapshot } from '../domain/period-closing.js';

/** Fila de la cabecera de `period_closing` (clave (curso, período) + token de versión). */
export type PeriodClosingHeaderRow = {
  readonly course_id: string;
  readonly period: string;
  readonly tenant_id: string;
  readonly version: number;
};

/** Fila de `period_closing_entry` (una por override manual del curso en el período). */
export type PeriodClosingEntryRow = {
  readonly student_id: string;
  readonly value: number;
  readonly motive: string | null;
};

/** Mapper **explícito** cabecera + entradas → snapshot (D7). */
export function rowToSnapshot(
  header: PeriodClosingHeaderRow,
  entries: readonly PeriodClosingEntryRow[],
): PeriodClosingSnapshot {
  return {
    courseId: header.course_id,
    period: header.period,
    tenantId: header.tenant_id,
    entries: entries.map((entry) => ({
      studentId: entry.student_id,
      value: entry.value,
      motive: entry.motive,
    })),
    version: header.version,
  };
}

/** Parámetros de la cabecera del `INSERT`/`UPDATE`, en orden (D7). */
export function headerParams(snapshot: PeriodClosingSnapshot): readonly unknown[] {
  return [snapshot.courseId, snapshot.period, snapshot.tenantId, snapshot.version];
}
