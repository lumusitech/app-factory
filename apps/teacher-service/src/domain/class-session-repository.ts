import type { ClassSession } from './class-session.js';

/**
 * Puerto **por agregado** (D6): nunca un `Repository<T>` genérico.
 *
 * Igual que §4.1, el puerto **no** recibe el alcance: el adaptador concreto lo
 * consume por ALS y aplica el predicado de tenant (D11, ADR 0010 punto 7).
 */
export interface ClassSessionRepository {
  byId(id: string): Promise<ClassSession | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(session: ClassSession): Promise<void>;
}
