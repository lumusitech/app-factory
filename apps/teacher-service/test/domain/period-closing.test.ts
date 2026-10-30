import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { PeriodClosing } from '../../src/domain/period-closing.js';

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-30T12:00:00.000Z');
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

function create(overrides: Partial<Parameters<typeof PeriodClosing.create>[0]> = {}): PeriodClosing {
  return PeriodClosing.create({
    tenantId: 'docente-1',
    courseId: 'curso-3-1',
    period: 'C1',
    entries: [
      { studentId: 'legajo-2', value: 8, motive: 'Recuperó el TP' },
      { studentId: 'legajo-1', value: 7 },
    ],
    ...deps(),
    ...overrides,
  });
}

describe('PeriodClosing — cierre de período como agregado batch (F-12, ADR 0016)', () => {
  it('crea la hoja (versión 1) ordenada por alumno y emite `period-closing.recorded`', () => {
    const closing = create();

    expect(closing.snapshot()).toEqual({
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', value: 7, motive: null },
        { studentId: 'legajo-2', value: 8, motive: 'Recuperó el TP' },
      ],
      version: 1,
    });
    expect(closing.pullEvents()[0]).toMatchObject({
      type: 'period-closing.recorded',
      aggregateId: 'curso-3-1',
    });
  });

  it('borde: acepta los límites de la escala (valor 1 y valor 10, T16)', () => {
    const closing = create({
      entries: [
        { studentId: 'legajo-1', value: 1 },
        { studentId: 'legajo-2', value: 10 },
      ],
    });
    expect(closing.snapshot().entries).toEqual([
      { studentId: 'legajo-1', value: 1, motive: null },
      { studentId: 'legajo-2', value: 10, motive: null },
    ]);
  });

  it('borde: rechaza valor fuera de rango (0 y 11) y no entero', () => {
    expect(() => create({ entries: [{ studentId: 'l1', value: 0 }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'l1', value: 11 }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'l1', value: 7.5 }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'l1', value: '7' }] })).toThrow();
  });

  it("borde: el `motive` es opcional (texto vacío → null) y acotado", () => {
    const closing = create({
      entries: [
        { studentId: 'legajo-1', value: 7, motive: '  ' },
        { studentId: 'legajo-2', value: 8, motive: 'Motivo válido' },
      ],
    });
    expect(closing.snapshot().entries).toEqual([
      { studentId: 'legajo-1', value: 7, motive: null },
      { studentId: 'legajo-2', value: 8, motive: 'Motivo válido' },
    ]);
    expect(() =>
      create({ entries: [{ studentId: 'l1', value: 7, motive: 'x'.repeat(5000) }] }),
    ).toThrow();
  });

  it('borde: rechaza `studentId` duplicado, entradas mal formadas y período vacío', () => {
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
    expect(() => create({ period: '   ' })).toThrow();
    expect(() => create({ courseId: '' })).toThrow();
  });

  it('borde: una hoja sin overrides es válida (quita todo override del período)', () => {
    expect(create({ entries: [] }).snapshot().entries).toEqual([]);
  });

  it('borde: reemplazar por los mismos overrides es no-op (sin versión)', () => {
    const closing = create();
    closing.pullEvents();

    const noop = closing.replace({
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      period: 'C1',
      entries: [
        { studentId: 'legajo-1', value: 7 },
        { studentId: 'legajo-2', value: 8, motive: 'Recuperó el TP' },
      ],
      ...deps(),
    });

    expect(noop).toBe(closing);
    expect(noop.version).toBe(1);
    expect(noop.pullEvents()).toHaveLength(0);
  });

  it('reemplazar con otro override sube la versión y emite el evento', () => {
    const next = create().replace({
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      period: 'C1',
      entries: [{ studentId: 'legajo-1', value: 10 }],
      ...deps(),
    });

    expect(next.snapshot()).toMatchObject({ version: 2 });
    expect(next.snapshot().entries).toEqual([{ studentId: 'legajo-1', value: 10, motive: null }]);
    expect(next.pullEvents()[0]).toMatchObject({ type: 'period-closing.recorded' });
  });

  it('borde: cambiar el motivo (misma nota) sube la versión', () => {
    const next = create({
      entries: [{ studentId: 'legajo-1', value: 7, motive: 'a' }],
    }).replace({
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      period: 'C1',
      entries: [{ studentId: 'legajo-1', value: 7, motive: 'b' }],
      ...deps(),
    });
    expect(next.version).toBe(2);
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 't',
      entries: [{ studentId: 'legajo-1', value: 9, motive: null }],
      version: 2,
    } as const;

    expect(PeriodClosing.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(PeriodClosing.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => PeriodClosing.hydrate({ ...snapshot, version: 0 })).toThrow();
    expect(() =>
      PeriodClosing.hydrate({ ...snapshot, entries: [{ studentId: 'l', value: 11, motive: null }] }),
    ).toThrow();
  });

  it('el token de versión es la forma decimal del entero (sync §8.1)', () => {
    expect(create().versionToken).toBe('1');
  });
});
