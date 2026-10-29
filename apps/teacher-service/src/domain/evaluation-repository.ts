import type { Evaluation } from './evaluation.js';

/**
 * Puerto **por agregado** (D6). La evaluación es un agregado de solo creación en
 * F-02 (ADR 0012).
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface EvaluationRepository {
  byId(id: string): Promise<Evaluation | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(evaluation: Evaluation): Promise<void>;
}
