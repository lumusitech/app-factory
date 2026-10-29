import type { AssignmentSnapshot } from '../domain/assignment.js';

/** Fila de `assignment`. `type` (no `interface`) por el alias con índice implícito. */
export type AssignmentRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly class_session_id: string;
  readonly topic_id: string | null;
  readonly content: string;
  readonly version: number;
};

/** Mapper **explícito** fila → snapshot (D7). Invariantes: `Assignment.hydrate`. */
export function rowToSnapshot(row: AssignmentRow): AssignmentSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classSessionId: row.class_session_id,
    topicId: row.topic_id,
    content: row.content,
    version: row.version,
  };
}

/** Parámetros del `INSERT`, en orden (mapper snapshot → fila, D7). */
export function snapshotToParams(snapshot: AssignmentSnapshot): readonly unknown[] {
  return [snapshot.id, snapshot.tenantId, snapshot.classSessionId, snapshot.topicId, snapshot.content, snapshot.version];
}
