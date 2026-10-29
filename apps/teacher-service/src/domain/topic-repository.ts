import type { Topic } from './topic.js';

/**
 * Puerto **por agregado** (D6): nunca un `Repository<T>` genérico.
 *
 * Igual que §4.1, el puerto **no** recibe el alcance: el adaptador concreto lo
 * consume por ALS y aplica el predicado de tenant (D11, ADR 0011).
 */
export interface TopicRepository {
  byId(id: string): Promise<Topic | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(topic: Topic): Promise<void>;
}
