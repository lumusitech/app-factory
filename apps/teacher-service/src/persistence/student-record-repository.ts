import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { StudentRecord } from '../domain/student-record.js';
import type { StudentRecordRepository } from '../domain/student-record-repository.js';
import { rowToSnapshot, snapshotToParams } from './student-record-row.js';
import type { StudentRecordRow } from './student-record-row.js';

const SELECT_COLUMNS =
  'id, tenant_id, student_id, kind, occurred_on::text AS occurred_on, note, category, evaluation_id, grade, version';

/**
 * Adaptador de salida de `StudentRecordRepository` (D7; ADR 0015).
 *
 * Aplica el **predicado de tenant** desde el `TransactionContext` (§4.1) y escribe
 * el outbox en la **misma** transacción (D9/D10).
 */
export class PgStudentRecordRepository implements StudentRecordRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<StudentRecord | null> {
    const { rows } = await this.context.executor.query<StudentRecordRow>(
      `SELECT ${SELECT_COLUMNS} FROM student_record WHERE tenant_id = $1 AND id = $2`,
      [this.context.tenantId, id],
    );

    const row = rows[0];
    return row === undefined ? null : StudentRecord.hydrate(rowToSnapshot(row));
  }

  async listByStudent(studentId: string): Promise<readonly StudentRecord[]> {
    const { rows } = await this.context.executor.query<StudentRecordRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM student_record
        WHERE tenant_id = $1 AND student_id = $2
        ORDER BY occurred_on ASC, id ASC`,
      [this.context.tenantId, studentId],
    );

    return rows.map((row) => StudentRecord.hydrate(rowToSnapshot(row)));
  }

  async save(record: StudentRecord): Promise<void> {
    await this.context.executor.query(
      `INSERT INTO student_record
         (id, tenant_id, student_id, kind, occurred_on, note, category, evaluation_id, grade, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, id) DO UPDATE SET student_id = EXCLUDED.student_id,
                                                 kind = EXCLUDED.kind,
                                                 occurred_on = EXCLUDED.occurred_on,
                                                 note = EXCLUDED.note,
                                                 category = EXCLUDED.category,
                                                 evaluation_id = EXCLUDED.evaluation_id,
                                                 grade = EXCLUDED.grade,
                                                 version = EXCLUDED.version`,
      snapshotToParams(record.snapshot()),
    );

    await this.outbox.append(record.pullEvents());
  }
}
