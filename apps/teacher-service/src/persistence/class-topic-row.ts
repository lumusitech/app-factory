import type { ClassTopicSnapshot } from '../domain/class-topic.js';

/**
 * Fila de `class_topic` (una por clase). Se declara como `type` (no `interface`)
 * porque `SqlExecutor.query<T>` exige un alias con índice implícito.
 */
export type ClassTopicRow = {
  readonly class_session_id: string;
  readonly tenant_id: string;
  readonly topic_id: string;
  readonly version: number;
};

/** Mapper **explícito** fila → snapshot (D7). Invariantes: `ClassTopic.hydrate`. */
export function rowToSnapshot(row: ClassTopicRow): ClassTopicSnapshot {
  return {
    classSessionId: row.class_session_id,
    tenantId: row.tenant_id,
    topicId: row.topic_id,
    version: row.version,
  };
}

/** Parámetros del `INSERT`/`UPDATE`, en orden (mapper snapshot → fila, D7). */
export function snapshotToParams(snapshot: ClassTopicSnapshot): readonly unknown[] {
  return [snapshot.classSessionId, snapshot.tenantId, snapshot.topicId, snapshot.version];
}
