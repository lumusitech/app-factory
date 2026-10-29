import { describe, expect, it } from 'vitest';

import { TrajectoryAssessment } from '../../src/domain/trajectory-assessment.js';
import { headerParams, rowToSnapshot } from '../../src/persistence/trajectory-assessment-row.js';
import type {
  TrajectoryAssessmentEntryRow,
  TrajectoryAssessmentHeaderRow,
} from '../../src/persistence/trajectory-assessment-row.js';

describe('mapper de TrajectoryAssessment (D7: entidad de persistencia + mapper explícito)', () => {
  it('cabecera + entradas → snapshot, y vuelta por `hydrate`', () => {
    const header: TrajectoryAssessmentHeaderRow = {
      course_id: 'curso-3-1',
      period: 'C1',
      tenant_id: 'docente-1',
      version: 2,
    };
    const entries: readonly TrajectoryAssessmentEntryRow[] = [
      { student_id: 'legajo-1', rating: 'TEA' },
      { student_id: 'legajo-2', rating: 'TED' },
    ];

    const snapshot = rowToSnapshot(header, entries);
    expect(snapshot).toEqual({
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', rating: 'TEA' },
        { studentId: 'legajo-2', rating: 'TED' },
      ],
      version: 2,
    });
    expect(headerParams(snapshot)).toEqual(['curso-3-1', 'C1', 'docente-1', 2]);
    expect(TrajectoryAssessment.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('borde: una hoja sin entradas se mapea a una lista vacía', () => {
    const snapshot = rowToSnapshot(
      { course_id: 'curso-3-1', period: 'C2', tenant_id: 'docente-1', version: 1 },
      [],
    );
    expect(snapshot.entries).toEqual([]);
  });
});
