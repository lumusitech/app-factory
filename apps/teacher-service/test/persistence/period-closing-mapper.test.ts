import { describe, expect, it } from 'vitest';

import { PeriodClosing } from '../../src/domain/period-closing.js';
import { headerParams, rowToSnapshot } from '../../src/persistence/period-closing-row.js';
import type { PeriodClosingEntryRow, PeriodClosingHeaderRow } from '../../src/persistence/period-closing-row.js';

describe('mapper de PeriodClosing (D7: entidad de persistencia + mapper explícito)', () => {
  it('cabecera + entradas → snapshot, y vuelta por `hydrate`', () => {
    const header: PeriodClosingHeaderRow = {
      course_id: 'curso-3-1',
      period: 'C1',
      tenant_id: 'docente-1',
      version: 2,
    };
    const entries: readonly PeriodClosingEntryRow[] = [
      { student_id: 'legajo-1', value: 7, motive: 'Recuperó el TP' },
      { student_id: 'legajo-2', value: 9, motive: null },
    ];

    const snapshot = rowToSnapshot(header, entries);
    expect(snapshot).toEqual({
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', value: 7, motive: 'Recuperó el TP' },
        { studentId: 'legajo-2', value: 9, motive: null },
      ],
      version: 2,
    });
    expect(headerParams(snapshot)).toEqual(['curso-3-1', 'C1', 'docente-1', 2]);
    expect(PeriodClosing.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('borde: una hoja sin overrides se mapea a una lista vacía', () => {
    const snapshot = rowToSnapshot(
      { course_id: 'curso-3-1', period: 'C2', tenant_id: 'docente-1', version: 1 },
      [],
    );
    expect(snapshot.entries).toEqual([]);
  });
});
