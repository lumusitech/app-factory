import type { TopicSnapshot } from '../domain/topic.js';

/**
 * Fila de `topic`. La columna del orden se llama `order_index` porque `order` es
 * palabra reservada de SQL.
 *
 * Se declara como `type` (no `interface`): `SqlExecutor.query<T>` exige un alias
 * con índice implícito.
 */
export type TopicRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly course_id: string;
  readonly order_index: number;
  readonly content: string;
  readonly version: number;
};

/** Mapper **explícito** fila → snapshot (D7). Los invariantes los valida `Topic.hydrate`. */
export function rowToSnapshot(row: TopicRow): TopicSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    courseId: row.course_id,
    order: row.order_index,
    content: row.content,
    version: row.version,
  };
}

/** Parámetros del `INSERT`/`UPDATE`, en orden (mapper snapshot → fila, D7). */
export function snapshotToParams(snapshot: TopicSnapshot): readonly unknown[] {
  return [snapshot.id, snapshot.tenantId, snapshot.courseId, snapshot.order, snapshot.content, snapshot.version];
}
