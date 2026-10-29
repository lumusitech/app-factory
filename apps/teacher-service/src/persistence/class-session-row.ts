import type { ClassSessionSnapshot, ClassStatus } from '../domain/class-session.js';

/**
 * Fila de `class_session`. La columna `date` se lee **como texto**
 * (`date::text`, `YYYY-MM-DD`) para no depender del parseo de fecha del driver
 * (que devolvería un instante y arriesgaría corrimientos de zona horaria).
 *
 * Se declara como `type` (no `interface`): `SqlExecutor.query<T>` exige un alias
 * con índice implícito.
 */
export type ClassSessionRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly course_id: string;
  readonly date: string;
  readonly status: string;
  readonly cancellation_reason: string | null;
  readonly version: number;
};

/**
 * Mapper **explícito** fila → snapshot del agregado (D7). La validación de
 * invariantes la hace `ClassSession.hydrate`; acá solo se traduce.
 */
export function rowToSnapshot(row: ClassSessionRow): ClassSessionSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    date: row.date,
    status: row.status as ClassStatus,
    cancellationReason: row.cancellation_reason,
    version: row.version,
  };
}

/** Parámetros del `INSERT`/`UPDATE`, en orden (mapper explícito snapshot → fila, D7). */
export function snapshotToParams(snapshot: ClassSessionSnapshot): readonly unknown[] {
  return [
    snapshot.id,
    snapshot.tenantId,
    snapshot.courseId,
    snapshot.date,
    snapshot.status,
    snapshot.cancellationReason,
    snapshot.version,
  ];
}
