import type { StudentRecord } from './student-record.js';

/**
 * Puerto **por agregado** (D6): nunca un `Repository<T>` genérico.
 *
 * El registro del alumno es un **log append-only** de solo creación (ADR 0015):
 * se **agrega** una entrada y se **leen** las del alumno. El puerto **no** recibe
 * el alcance: el adaptador lo aplica desde el ALS (D11).
 */
export interface StudentRecordRepository {
  byId(id: string): Promise<StudentRecord | null>;
  /** Entradas del alumno, ordenadas por fecha y luego por id (deterministas). */
  listByStudent(studentId: string): Promise<readonly StudentRecord[]>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(record: StudentRecord): Promise<void>;
}
