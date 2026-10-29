import type { GradeSheet } from './grade-sheet.js';

/**
 * Puerto **por agregado** (D6). La hoja de notas es un agregado por evaluación.
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface GradeSheetRepository {
  byEvaluationId(evaluationId: string): Promise<GradeSheet | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(sheet: GradeSheet): Promise<void>;
}
