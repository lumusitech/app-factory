import type { Assignment } from './assignment.js';

/**
 * Puerto **por agregado** (D6). La consigna del día es su propia entidad.
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface AssignmentRepository {
  byId(id: string): Promise<Assignment | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(assignment: Assignment): Promise<void>;
}
