import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { ClassTopic } from '../../src/domain/class-topic.js';

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

function create(overrides: Partial<Parameters<typeof ClassTopic.create>[0]> = {}): ClassTopic {
  return ClassTopic.create({
    tenantId: 'docente-1',
    classSessionId: 'sesion-1',
    topicId: 'tema-1',
    ...deps(),
    ...overrides,
  });
}

describe('ClassTopic — tema dictado (vínculo Clase↔Tema)', () => {
  it('crea el vínculo (versión 1) y emite `class-topic.set`', () => {
    const link = create();

    expect(link.snapshot()).toEqual({
      classSessionId: 'sesion-1',
      tenantId: 'docente-1',
      topicId: 'tema-1',
      version: 1,
    });
    expect(link.pullEvents()[0]).toMatchObject({
      type: 'class-topic.set',
      aggregateId: 'sesion-1',
    });
  });

  it('cambiar el tema sube la versión y emite el evento', () => {
    const created = create();
    created.pullEvents(); // drena el evento de creación

    const next = created.setTopic({
      tenantId: 'docente-1',
      classSessionId: 'sesion-1',
      topicId: 'tema-2',
      ...deps(),
    });

    expect(next.snapshot()).toMatchObject({ topicId: 'tema-2', version: 2 });
    expect(next.pullEvents()[0]).toMatchObject({ type: 'class-topic.set', payload: { topicId: 'tema-2' } });
  });

  it('borde: re-fijar el mismo tema es no-op (sin evento ni versión)', () => {
    const link = create();
    link.pullEvents();

    const noop = link.setTopic({
      tenantId: 'docente-1',
      classSessionId: 'sesion-1',
      topicId: 'tema-1',
      ...deps(),
    });

    expect(noop).toBe(link);
    expect(noop.version).toBe(1);
    expect(noop.pullEvents()).toHaveLength(0);
  });

  it('borde: rechaza `classSessionId`/`topicId` vacíos', () => {
    expect(() => create({ classSessionId: '  ' })).toThrow();
    expect(() => create({ topicId: '  ' })).toThrow();
  });

  it('borde: `hydrate` valida invariantes sin re-emitir', () => {
    const snapshot = {
      classSessionId: 'sesion-1',
      tenantId: 't',
      topicId: 'tema-1',
      version: 3,
    } as const;

    expect(ClassTopic.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(ClassTopic.hydrate(snapshot).pullEvents()).toHaveLength(0);
    expect(() => ClassTopic.hydrate({ ...snapshot, topicId: '' })).toThrow();
    expect(() => ClassTopic.hydrate({ ...snapshot, version: 0 })).toThrow();
  });
});
