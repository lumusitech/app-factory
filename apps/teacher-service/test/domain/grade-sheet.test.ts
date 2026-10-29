import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { GradeSheet } from '../../src/domain/grade-sheet.js';

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

function create(overrides: Partial<Parameters<typeof GradeSheet.create>[0]> = {}): GradeSheet {
  return GradeSheet.create({
    tenantId: 'docente-1',
    evaluationId: 'eval-1',
    entries: [
      { studentId: 'legajo-2', value: 8 },
      { studentId: 'legajo-1', value: 7 },
    ],
    ...deps(),
    ...overrides,
  });
}

describe('GradeSheet — notas como agregado por evaluación (F-02, ADR 0012)', () => {
  it('crea la hoja (versión 1) ordenada por alumno y emite `grades.recorded`', () => {
    const sheet = create();

    expect(sheet.snapshot()).toEqual({
      evaluationId: 'eval-1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', value: 7 },
        { studentId: 'legajo-2', value: 8 },
      ],
      version: 1,
    });
    expect(sheet.pullEvents()[0]).toMatchObject({
      type: 'grades.recorded',
      aggregateId: 'eval-1',
    });
  });

  it('borde: acepta los límites de la escala (valor 1 y valor 10, T16)', () => {
    const sheet = create({
      entries: [
        { studentId: 'legajo-1', value: 1 },
        { studentId: 'legajo-2', value: 10 },
      ],
    });
    expect(sheet.snapshot().entries).toEqual([
      { studentId: 'legajo-1', value: 1 },
      { studentId: 'legajo-2', value: 10 },
    ]);
  });

  it('borde: rechaza valor fuera de rango (0 y 11) y no entero', () => {
    expect(() => create({ entries: [{ studentId: 'l1', value: 0 }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'l1', value: 11 }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'l1', value: 7.5 }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'l1', value: '7' }] })).toThrow();
  });

  it('borde: rechaza `studentId` duplicado y entradas mal formadas', () => {
    expect(() =>
      create({
        entries: [
          { studentId: 'legajo-1', value: 7 },
          { studentId: 'legajo-1', value: 8 },
        ],
      }),
    ).toThrow();
    expect(() => create({ entries: [{ studentId: '  ', value: 7 }] })).toThrow();
    expect(() => create({ entries: 'no-es-lista' })).toThrow();
  });

  it('borde: una hoja sin alumnos es válida (curso vacío, §8)', () => {
    expect(create({ entries: [] }).snapshot().entries).toEqual([]);
  });

  it('borde: reemplazar por las mismas entradas es no-op (sin versión)', () => {
    const sheet = create();
    sheet.pullEvents();

    const noop = sheet.replace({
      tenantId: 'docente-1',
      evaluationId: 'eval-1',
      // Mismo contenido, distinto orden: la comparación es por alumno.
      entries: [
        { studentId: 'legajo-1', value: 7 },
        { studentId: 'legajo-2', value: 8 },
      ],
      ...deps(),
    });

    expect(noop).toBe(sheet);
    expect(noop.version).toBe(1);
    expect(noop.pullEvents()).toHaveLength(0);
  });

  it('reemplazar con otra nota sube la versión y emite el evento', () => {
    const next = create().replace({
      tenantId: 'docente-1',
      evaluationId: 'eval-1',
      entries: [{ studentId: 'legajo-1', value: 10 }],
      ...deps(),
    });

    expect(next.snapshot()).toMatchObject({ version: 2 });
    expect(next.snapshot().entries).toEqual([{ studentId: 'legajo-1', value: 10 }]);
    expect(next.pullEvents()[0]).toMatchObject({ type: 'grades.recorded' });
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      evaluationId: 'eval-1',
      tenantId: 't',
      entries: [{ studentId: 'legajo-1', value: 9 }],
      version: 2,
    } as const;

    expect(GradeSheet.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(GradeSheet.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => GradeSheet.hydrate({ ...snapshot, version: 0 })).toThrow();
    expect(() => GradeSheet.hydrate({ ...snapshot, entries: [{ studentId: 'l', value: 11 }] })).toThrow();
  });
});
