import type { TrajectoryAssessment } from './trajectory-assessment.js';

/**
 * Puerto **por agregado** (D6). La valoración preliminar es un agregado por
 * (curso, período): su clave es la tupla, no un id propio.
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface TrajectoryAssessmentRepository {
  byCourseAndPeriod(courseId: string, period: string): Promise<TrajectoryAssessment | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(assessment: TrajectoryAssessment): Promise<void>;
}
