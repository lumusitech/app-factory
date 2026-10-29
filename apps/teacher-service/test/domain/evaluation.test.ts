import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { Evaluation } from '../../src/domain/evaluation.js';

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

function create(overrides: Partial<Parameters<typeof Evaluation.create>[0]> = {}): Evaluation {
  return Evaluation.create({
    tenantId: 'docente-1',
    courseId: 'curso-3-1',
    name: 'Parcial 1',
    period: 'C1',
    weight: 1,
    ...deps(),
    ...overrides,
  });
}

describe('Evaluation — evaluación de un curso (F-02, ADR 0012)', () => {
  it('crea la evaluación (versión 1) y emite `evaluation.created`', () => {
    const evaluation = create();

    expect(evaluation.snapshot()).toEqual({
      id: 'id-1',
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      name: 'Parcial 1',
      period: 'C1',
      weight: 1,
      version: 1,
    });
    expect(evaluation.pullEvents()[0]).toMatchObject({
      type: 'evaluation.created',
      aggregateId: 'id-1',
    });
  });

  it('acepta el `id` del cliente (crear y calificar en la misma sesión offline)', () => {
    expect(create({ id: 'eval-cliente-1' }).id).toBe('eval-cliente-1');
  });

  it('borde: exige nombre, período y curso no vacíos', () => {
    expect(() => create({ name: '   ' })).toThrow();
    expect(() => create({ period: '' })).toThrow();
    expect(() => create({ courseId: '  ' })).toThrow();
  });

  it('borde: el peso debe ser un número positivo (no cero, no negativo, no no-numérico)', () => {
    expect(() => create({ weight: 0 })).toThrow();
    expect(() => create({ weight: -1 })).toThrow();
    expect(() => create({ weight: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => create({ weight: '1' })).toThrow();
    expect(create({ weight: 2.5 }).weight).toBe(2.5);
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      id: 'eval-1',
      tenantId: 't',
      courseId: 'curso-1',
      name: 'Parcial',
      period: 'C1',
      weight: 2,
      version: 1,
    } as const;

    expect(Evaluation.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(Evaluation.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => Evaluation.hydrate({ ...snapshot, version: 0 })).toThrow();
    expect(() => Evaluation.hydrate({ ...snapshot, weight: 0 })).toThrow();
  });
});
