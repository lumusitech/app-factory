import type { PeriodClosing } from './period-closing.js';

/**
 * Puerto **por agregado** (D6). El cierre de período es un agregado por
 * (curso, período): su clave es la tupla, no un id propio.
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface PeriodClosingRepository {
  byCourseAndPeriod(courseId: string, period: string): Promise<PeriodClosing | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(closing: PeriodClosing): Promise<void>;
}
