import { describe, expect, it } from 'vitest';

import { ClassSession } from '../../src/domain/class-session.js';
import { rowToSnapshot, snapshotToParams } from '../../src/persistence/class-session-row.js';
import type { ClassSessionRow } from '../../src/persistence/class-session-row.js';

describe('mapper de ClassSession (D7: entidad de persistencia + mapper explícito)', () => {
  it('fila → snapshot → parámetros de INSERT, y vuelta por `hydrate`', () => {
    const row: ClassSessionRow = {
      id: 'sesion-1',
      tenant_id: 'docente-1',
      course_id: 'curso-3-1',
      date: '2026-10-29',
      status: 'dictada',
      cancellation_reason: null,
      version: 1,
    };

    const snapshot = rowToSnapshot(row);
    expect(snapshot).toEqual({
      id: 'sesion-1',
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      date: '2026-10-29',
      status: 'dictada',
      cancellationReason: null,
      version: 1,
    });

    expect(snapshotToParams(snapshot)).toEqual([
      'sesion-1',
      'docente-1',
      'curso-3-1',
      '2026-10-29',
      'dictada',
      null,
      1,
    ]);
    expect(ClassSession.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('borde: fila cancelada conserva el motivo', () => {
    const row: ClassSessionRow = {
      id: 'sesion-2',
      tenant_id: 'docente-1',
      course_id: 'curso-3-1',
      date: '2026-10-29',
      status: 'cancelada',
      cancellation_reason: 'paro',
      version: 2,
    };

    expect(rowToSnapshot(row)).toMatchObject({
      status: 'cancelada',
      cancellationReason: 'paro',
      version: 2,
    });
  });
});
