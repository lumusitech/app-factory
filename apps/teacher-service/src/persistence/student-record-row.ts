import type { StudentRecordKind, StudentRecordSnapshot } from '../domain/student-record.js';

/**
 * Fila de `student_record`. La columna `occurred_on` se lee **como texto**
 * (`occurred_on::text`, `YYYY-MM-DD`) para no depender del parseo de fecha del
 * driver (evita corrimientos de zona horaria), igual que `class_session.date`.
 *
 * Se declara como `type` (no `interface`): `SqlExecutor.query<T>` exige un alias
 * con índice implícito.
 */
export type StudentRecordRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly student_id: string;
  readonly kind: string;
  readonly occurred_on: string;
  readonly note: string | null;
  readonly category: string | null;
  readonly evaluation_id: string | null;
  readonly grade: number | null;
  readonly version: number;
};

/**
 * Mapper **explícito** fila → snapshot (D7). Los invariantes los valida
 * `StudentRecord.hydrate`.
 */
export function rowToSnapshot(row: StudentRecordRow): StudentRecordSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentId: row.student_id,
    kind: row.kind as StudentRecordKind,
    occurredOn: row.occurred_on,
    note: row.note,
    category: row.category,
    evaluationId: row.evaluation_id,
    grade: row.grade,
    version: row.version,
  };
}

/** Parámetros del `INSERT`/`UPDATE`, en orden (mapper snapshot → fila, D7). */
export function snapshotToParams(snapshot: StudentRecordSnapshot): readonly unknown[] {
  return [
    snapshot.id,
    snapshot.tenantId,
    snapshot.studentId,
    snapshot.kind,
    snapshot.occurredOn,
    snapshot.note,
    snapshot.category,
    snapshot.evaluationId,
    snapshot.grade,
    snapshot.version,
  ];
}
