import { describe, expect, it } from 'vitest';

import { StudentRecord } from '../../src/domain/student-record.js';
import { rowToSnapshot, snapshotToParams } from '../../src/persistence/student-record-row.js';
import type { StudentRecordRow } from '../../src/persistence/student-record-row.js';

describe('mapper de StudentRecord (D7: entidad de persistencia + mapper explícito)', () => {
  it('fila → snapshot → parámetros de INSERT, y vuelta por `hydrate`', () => {
    const row: StudentRecordRow = {
      id: 'r1',
      tenant_id: 'docente-1',
      student_id: 'legajo-1',
      kind: 'evaluacion',
      occurred_on: '2026-10-30',
      note: 'Corrige y reentrega.',
      category: null,
      evaluation_id: 'e1',
      grade: 8,
      version: 1,
    };

    const snapshot = rowToSnapshot(row);
    expect(snapshot).toEqual({
      id: 'r1',
      tenantId: 'docente-1',
      studentId: 'legajo-1',
      kind: 'evaluacion',
      occurredOn: '2026-10-30',
      note: 'Corrige y reentrega.',
      category: null,
      evaluationId: 'e1',
      grade: 8,
      version: 1,
    });

    expect(snapshotToParams(snapshot)).toEqual([
      'r1',
      'docente-1',
      'legajo-1',
      'evaluacion',
      '2026-10-30',
      'Corrige y reentrega.',
      null,
      'e1',
      8,
      1,
    ]);
    expect(StudentRecord.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('borde: una observación con campos nulos se mapea sin arrastrar valores', () => {
    const row: StudentRecordRow = {
      id: 'r2',
      tenant_id: 'docente-1',
      student_id: 'legajo-2',
      kind: 'observacion',
      occurred_on: '2026-10-31',
      note: 'Prestar atención al cuaderno de comunicados.',
      category: 'conducta',
      evaluation_id: null,
      grade: null,
      version: 1,
    };

    expect(rowToSnapshot(row)).toMatchObject({
      category: 'conducta',
      evaluationId: null,
      grade: null,
    });
  });
});
