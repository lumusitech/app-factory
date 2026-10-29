import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { Assignment } from '../../src/domain/assignment.js';

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

function create(overrides: Partial<Parameters<typeof Assignment.create>[0]> = {}): Assignment {
  return Assignment.create({
    tenantId: 'docente-1',
    classSessionId: 'sesion-1',
    content: 'Resolver los ejercicios 1 al 5',
    ...deps(),
    ...overrides,
  });
}

describe('Assignment — invariantes de dominio (tarea)', () => {
  it('crea una tarea (versión 1) con `topicId` nulo y emite `assignment.created`', () => {
    const assignment = create();

    expect(assignment.snapshot()).toEqual({
      id: 'id-1',
      tenantId: 'docente-1',
      classSessionId: 'sesion-1',
      topicId: null,
      content: 'Resolver los ejercicios 1 al 5',
      version: 1,
    });
    expect(assignment.pullEvents()[0]).toMatchObject({ type: 'assignment.created' });
  });

  it('acepta un `topicId` opcional', () => {
    expect(create({ topicId: 'tema-9' }).topicId).toBe('tema-9');
  });

  it('borde: recorta contenido y rechaza vacíos', () => {
    expect(create({ content: '  consigna  ' }).content).toBe('consigna');
    expect(() => create({ content: '   ' })).toThrow();
    expect(() => create({ classSessionId: '  ' })).toThrow();
  });

  it('borde: `topicId` vacío equivale a nulo; no vacío se recorta', () => {
    expect(create({ topicId: '' }).topicId).toBeNull();
    expect(create({ topicId: '  tema  ' }).topicId).toBe('tema');
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      id: 'a-1',
      tenantId: 't',
      classSessionId: 'sesion-1',
      topicId: 'tema-1',
      content: 'consigna',
      version: 1,
    } as const;

    expect(Assignment.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(Assignment.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => Assignment.hydrate({ ...snapshot, content: '' })).toThrow();
    expect(() => Assignment.hydrate({ ...snapshot, version: 0 })).toThrow();
  });
});
