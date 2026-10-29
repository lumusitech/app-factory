import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { ClassAttendance } from '../../src/domain/class-attendance.js';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-29T12:00:00.000Z');
  }
}

class SequenceIdGenerator implements IdGenerator {
  #value = 0;
  next(): string {
    this.#value += 1;
    return `id-${this.#value}`;
  }
}

function deps(): { clock: Clock; idGenerator: IdGenerator } {
  return { clock: new FixedClock(), idGenerator: new SequenceIdGenerator() };
}

function create(overrides: Partial<Parameters<typeof ClassAttendance.create>[0]> = {}): ClassAttendance {
  return ClassAttendance.create({
    tenantId: 'docente-1',
    classSessionId: 'sesion-1',
    entries: [
      { studentId: 'legajo-2', status: 'ausente' },
      { studentId: 'legajo-1', status: 'presente' },
    ],
    ...deps(),
    ...overrides,
  });
}

describe('ClassAttendance — asistencia como agregado por clase', () => {
  it('crea la hoja (versión 1) ordenada por alumno y emite `attendance.recorded`', () => {
    const attendance = create();

    expect(attendance.snapshot()).toEqual({
      classSessionId: 'sesion-1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', status: 'presente' },
        { studentId: 'legajo-2', status: 'ausente' },
      ],
      version: 1,
    });
    expect(attendance.pullEvents()[0]).toMatchObject({
      type: 'attendance.recorded',
      aggregateId: 'sesion-1',
    });
  });

  it('borde: una hoja sin alumnos es válida (curso vacío, §8)', () => {
    expect(create({ entries: [] }).snapshot().entries).toEqual([]);
  });

  it('borde: rechaza `studentId` duplicado', () => {
    expect(() =>
      create({
        entries: [
          { studentId: 'legajo-1', status: 'presente' },
          { studentId: 'legajo-1', status: 'ausente' },
        ],
      }),
    ).toThrow();
  });

  it('borde: rechaza estado inválido y entradas mal formadas', () => {
    expect(() => create({ entries: [{ studentId: 'l', status: 'desconocido' }] })).toThrow();
    expect(() => create({ entries: [{ studentId: '  ', status: 'presente' }] })).toThrow();
    expect(() => create({ entries: 'no-es-lista' })).toThrow();
  });

  it('borde: reemplazar por las mismas entradas es no-op (sin versión)', () => {
    const attendance = create();
    attendance.pullEvents();

    const noop = attendance.replace({
      tenantId: 'docente-1',
      classSessionId: 'sesion-1',
      // Mismo contenido, distinto orden: la comparación es por alumno.
      entries: [
        { studentId: 'legajo-1', status: 'presente' },
        { studentId: 'legajo-2', status: 'ausente' },
      ],
      ...deps(),
    });

    expect(noop).toBe(attendance);
    expect(noop.version).toBe(1);
    expect(noop.pullEvents()).toHaveLength(0);
  });

  it('reemplazar con otro estado sube la versión y emite el evento', () => {
    const next = create().replace({
      tenantId: 'docente-1',
      classSessionId: 'sesion-1',
      entries: [{ studentId: 'legajo-1', status: 'tarde' }],
      ...deps(),
    });

    expect(next.snapshot()).toMatchObject({ version: 2 });
    expect(next.snapshot().entries).toEqual([{ studentId: 'legajo-1', status: 'tarde' }]);
    expect(next.pullEvents()[0]).toMatchObject({ type: 'attendance.recorded' });
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      classSessionId: 'sesion-1',
      tenantId: 't',
      entries: [{ studentId: 'legajo-1', status: 'presente' as const }],
      version: 2,
    } as const;

    expect(ClassAttendance.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(ClassAttendance.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => ClassAttendance.hydrate({ ...snapshot, version: 0 })).toThrow();
  });
});
