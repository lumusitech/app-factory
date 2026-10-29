import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { TrajectoryAssessment } from '../../src/domain/trajectory-assessment.js';

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

function create(
  overrides: Partial<Parameters<typeof TrajectoryAssessment.create>[0]> = {},
): TrajectoryAssessment {
  return TrajectoryAssessment.create({
    tenantId: 'docente-1',
    courseId: 'curso-3-1',
    period: 'C1',
    entries: [
      { studentId: 'legajo-2', rating: 'TEP' },
      { studentId: 'legajo-1', rating: 'TEA' },
    ],
    ...deps(),
    ...overrides,
  });
}

describe('TrajectoryAssessment — valoración preliminar como agregado por (curso, período)', () => {
  it('crea la hoja (versión 1) ordenada por alumno y emite `trajectory-assessment.recorded`', () => {
    const assessment = create();

    expect(assessment.snapshot()).toEqual({
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', rating: 'TEA' },
        { studentId: 'legajo-2', rating: 'TEP' },
      ],
      version: 1,
    });
    expect(assessment.pullEvents()[0]).toMatchObject({
      type: 'trajectory-assessment.recorded',
      aggregateId: 'curso-3-1',
    });
  });

  it('borde: una hoja sin alumnos es válida (curso vacío, §8)', () => {
    expect(create({ entries: [] }).snapshot().entries).toEqual([]);
  });

  it('borde: rechaza `studentId` duplicado', () => {
    expect(() =>
      create({
        entries: [
          { studentId: 'legajo-1', rating: 'TEA' },
          { studentId: 'legajo-1', rating: 'TED' },
        ],
      }),
    ).toThrow();
  });

  it('borde: rechaza un `rating` fuera del enum TEA/TEP/TED (§3.4) y entradas mal formadas', () => {
    expect(() => create({ entries: [{ studentId: 'legajo-1', rating: 'Aprobado' }] })).toThrow();
    expect(() => create({ entries: [{ studentId: 'legajo-1', rating: 'tea' }] })).toThrow();
    expect(() => create({ entries: [{ studentId: '  ', rating: 'TEA' }] })).toThrow();
    expect(() => create({ entries: 'no-es-lista' })).toThrow();
  });

  it('borde: rechaza `courseId` y `period` vacíos (§7.8: el período es dato del calendario)', () => {
    expect(() => create({ courseId: '  ' })).toThrow();
    expect(() => create({ period: '' })).toThrow();
  });

  it('borde: reemplazar por las mismas entradas es no-op (sin versión)', () => {
    const assessment = create();
    assessment.pullEvents();

    const noop = assessment.replace({
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      period: 'C1',
      // Mismo contenido, distinto orden: la comparación es por alumno.
      entries: [
        { studentId: 'legajo-1', rating: 'TEA' },
        { studentId: 'legajo-2', rating: 'TEP' },
      ],
      ...deps(),
    });

    expect(noop).toBe(assessment);
    expect(noop.version).toBe(1);
    expect(noop.pullEvents()).toHaveLength(0);
  });

  it('reemplazar con otra valoración sube la versión y emite el evento', () => {
    const next = create().replace({
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      period: 'C1',
      entries: [{ studentId: 'legajo-1', rating: 'TED' }],
      ...deps(),
    });

    expect(next.snapshot()).toMatchObject({ version: 2 });
    expect(next.snapshot().entries).toEqual([{ studentId: 'legajo-1', rating: 'TED' }]);
    expect(next.pullEvents()[0]).toMatchObject({ type: 'trajectory-assessment.recorded' });
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 'docente-1',
      entries: [{ studentId: 'legajo-1', rating: 'TEA' as const }],
      version: 2,
    } as const;

    expect(TrajectoryAssessment.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(TrajectoryAssessment.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => TrajectoryAssessment.hydrate({ ...snapshot, version: 0 })).toThrow();
  });

  it('expone el token de versión opaco (sync §8.1)', () => {
    expect(TrajectoryAssessment.hydrate({
      courseId: 'curso-3-1',
      period: 'C1',
      tenantId: 'docente-1',
      entries: [],
      version: 3,
    }).versionToken).toBe('3');
  });
});
