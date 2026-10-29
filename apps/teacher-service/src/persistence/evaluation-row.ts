import type { EvaluationSnapshot } from '../domain/evaluation.js';

/**
 * Fila de `evaluation`. La columna `weight` es `numeric`: el driver la devuelve
 * como **texto** (para no perder precisión), así que el mapper la convierte a
 * número. Se declara como `type` (no `interface`): `SqlExecutor.query<T>` exige
 * un alias con índice implícito.
 */
export type EvaluationRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly course_id: string;
  readonly name: string;
  readonly period: string;
  readonly weight: string | number;
  readonly version: number;
};

/**
 * Mapper **explícito** fila → snapshot del agregado (D7). La validación de
 * invariantes la hace `Evaluation.hydrate`; acá solo se traduce.
 */
export function rowToSnapshot(row: EvaluationRow): EvaluationSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    name: row.name,
    period: row.period,
    weight: Number(row.weight),
    version: row.version,
  };
}

/** Parámetros del `INSERT`/`UPDATE`, en orden (mapper explícito snapshot → fila, D7). */
export function snapshotToParams(snapshot: EvaluationSnapshot): readonly unknown[] {
  return [
    snapshot.id,
    snapshot.tenantId,
    snapshot.courseId,
    snapshot.name,
    snapshot.period,
    snapshot.weight,
    snapshot.version,
  ];
}
