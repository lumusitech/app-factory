import type { ClassTopic } from './class-topic.js';

/**
 * Puerto **por agregado** (D6). La identidad del tema dictado es la **clase**.
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface ClassTopicRepository {
  byClassSessionId(classSessionId: string): Promise<ClassTopic | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(classTopic: ClassTopic): Promise<void>;
}
