import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { ClassAttendance } from '../domain/class-attendance.js';
import type { ClassAttendanceRepository } from '../domain/class-attendance-repository.js';
import { headerParams, rowToSnapshot } from './class-attendance-row.js';
import type { AttendanceEntryRow, ClassAttendanceHeaderRow } from './class-attendance-row.js';

/**
 * Adaptador de salida de `ClassAttendanceRepository` (D7; ADR 0011).
 *
 * El agregado es la hoja de la clase: cabecera `class_attendance` (identidad +
 * `version`) y filas `attendance_entry` por (clase, alumno). `save` **reemplaza**
 * la hoja completa (borra las entradas y las reinserta) en la **misma**
 * transacción que el outbox (D9/D10).
 */
export class PgClassAttendanceRepository implements ClassAttendanceRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byClassSessionId(classSessionId: string): Promise<ClassAttendance | null> {
    const header = await this.context.executor.query<ClassAttendanceHeaderRow>(
      `SELECT class_session_id, tenant_id, version
         FROM class_attendance
        WHERE tenant_id = $1 AND class_session_id = $2`,
      [this.context.tenantId, classSessionId],
    );

    const headerRow = header.rows[0];
    if (headerRow === undefined) {
      return null;
    }

    const entries = await this.context.executor.query<AttendanceEntryRow>(
      `SELECT student_id, status
         FROM attendance_entry
        WHERE tenant_id = $1 AND class_session_id = $2
        ORDER BY student_id`,
      [this.context.tenantId, classSessionId],
    );

    return ClassAttendance.hydrate(rowToSnapshot(headerRow, entries.rows));
  }

  async save(attendance: ClassAttendance): Promise<void> {
    const snapshot = attendance.snapshot();

    await this.context.executor.query(
      `INSERT INTO class_attendance (class_session_id, tenant_id, version)
       VALUES ($1, $2, $3)
       ON CONFLICT (class_session_id) DO UPDATE SET version = EXCLUDED.version`,
      headerParams(snapshot),
    );

    await this.context.executor.query(
      'DELETE FROM attendance_entry WHERE tenant_id = $1 AND class_session_id = $2',
      [this.context.tenantId, snapshot.classSessionId],
    );

    for (const entry of snapshot.entries) {
      await this.context.executor.query(
        `INSERT INTO attendance_entry (class_session_id, tenant_id, student_id, status)
         VALUES ($1, $2, $3, $4)`,
        [snapshot.classSessionId, snapshot.tenantId, entry.studentId, entry.status],
      );
    }

    await this.outbox.append(attendance.pullEvents());
  }
}
