import type { AttendanceStatus, ClassAttendanceSnapshot } from '../domain/class-attendance.js';

/** Fila de la cabecera de `class_attendance` (identidad + token de versión). */
export type ClassAttendanceHeaderRow = {
  readonly class_session_id: string;
  readonly tenant_id: string;
  readonly version: number;
};

/** Fila de `attendance_entry` (una por alumno de la clase). */
export type AttendanceEntryRow = {
  readonly student_id: string;
  readonly status: string;
};

/** Mapper **explícito** cabecera + entradas → snapshot (D7). */
export function rowToSnapshot(
  header: ClassAttendanceHeaderRow,
  entries: readonly AttendanceEntryRow[],
): ClassAttendanceSnapshot {
  return {
    classSessionId: header.class_session_id,
    tenantId: header.tenant_id,
    entries: entries.map((entry) => ({
      studentId: entry.student_id,
      status: entry.status as AttendanceStatus,
    })),
    version: header.version,
  };
}

/** Parámetros de la cabecera del `INSERT`/`UPDATE`, en orden (D7). */
export function headerParams(snapshot: ClassAttendanceSnapshot): readonly unknown[] {
  return [snapshot.classSessionId, snapshot.tenantId, snapshot.version];
}
