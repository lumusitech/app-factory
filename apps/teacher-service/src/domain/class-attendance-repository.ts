import type { ClassAttendance } from './class-attendance.js';

/**
 * Puerto **por agregado** (D6). La hoja de asistencia es un agregado por clase.
 *
 * El puerto **no** recibe el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface ClassAttendanceRepository {
  byClassSessionId(classSessionId: string): Promise<ClassAttendance | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(attendance: ClassAttendance): Promise<void>;
}
