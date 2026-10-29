import { describe, expect, it } from 'vitest';

import { GradeSheet } from '../../src/domain/grade-sheet.js';
import { headerParams, rowToSnapshot } from '../../src/persistence/grade-sheet-row.js';
import type { GradeEntryRow, GradeSheetHeaderRow } from '../../src/persistence/grade-sheet-row.js';

describe('mapper de GradeSheet (D7: entidad de persistencia + mapper explícito)', () => {
  it('cabecera + entradas → snapshot, y vuelta por `hydrate`', () => {
    const header: GradeSheetHeaderRow = { evaluation_id: 'eval-1', tenant_id: 'docente-1', version: 2 };
    const entries: readonly GradeEntryRow[] = [
      { student_id: 'legajo-1', value: 7 },
      { student_id: 'legajo-2', value: 10 },
    ];

    const snapshot = rowToSnapshot(header, entries);
    expect(snapshot).toEqual({
      evaluationId: 'eval-1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', value: 7 },
        { studentId: 'legajo-2', value: 10 },
      ],
      version: 2,
    });
    expect(headerParams(snapshot)).toEqual(['eval-1', 'docente-1', 2]);
    expect(GradeSheet.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('borde: una hoja sin entradas se mapea a una lista vacía', () => {
    const snapshot = rowToSnapshot(
      { evaluation_id: 'eval-1', tenant_id: 'docente-1', version: 1 },
      [],
    );
    expect(snapshot.entries).toEqual([]);
  });
});
