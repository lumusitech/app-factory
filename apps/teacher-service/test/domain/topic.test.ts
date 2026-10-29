import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { Topic } from '../../src/domain/topic.js';

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

function create(overrides: Partial<Parameters<typeof Topic.create>[0]> = {}): Topic {
  return Topic.create({
    tenantId: 'docente-1',
    courseId: 'curso-3-1',
    order: 1,
    content: 'Ecuaciones de primer grado',
    ...deps(),
    ...overrides,
  });
}

describe('Topic — invariantes de dominio', () => {
  it('crea un tema (versión 1) sin fechas y emite `topic.created`', () => {
    const topic = create();

    expect(topic.snapshot()).toEqual({
      id: 'id-1',
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      order: 1,
      content: 'Ecuaciones de primer grado',
      version: 1,
    });
    // Sin fecha: el cronograma se deriva (§7.2/§7.3).
    expect(topic.snapshot()).not.toHaveProperty('date');

    const events = topic.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'topic.created', aggregateId: 'id-1' });
  });

  it('acepta un `id` aportado por el cliente (para crear y vincular offline)', () => {
    expect(create({ id: 'tema-cliente-1' }).id).toBe('tema-cliente-1');
  });

  it('borde: recorta `courseId` y contenido; rechaza vacíos', () => {
    expect(create({ courseId: '  curso  ', content: '  tema  ' }).snapshot()).toMatchObject({
      courseId: 'curso',
      content: 'tema',
    });
    expect(() => create({ courseId: '   ' })).toThrow();
    expect(() => create({ content: '   ' })).toThrow();
  });

  it('borde: `order` debe ser entero entre 1 y el máximo', () => {
    for (const order of [0, -1, 1.5, 10001, Number.NaN]) {
      expect(() => create({ order })).toThrow();
    }
    expect(create({ order: 10 }).order).toBe(10);
  });

  it('borde: `id` del cliente no vacío', () => {
    expect(() => create({ id: '   ' })).toThrow();
  });

  it('borde: `hydrate` reconstruye sin re-emitir y valida invariantes', () => {
    const snapshot = {
      id: 'x',
      tenantId: 't',
      courseId: 'c',
      order: 3,
      content: 'tema',
      version: 2,
    } as const;

    const hydrated = Topic.hydrate(snapshot);
    expect(hydrated.snapshot()).toEqual(snapshot);
    expect(hydrated.pullEvents()).toHaveLength(0);

    expect(() => Topic.hydrate({ ...snapshot, order: 0 })).toThrow();
    expect(() => Topic.hydrate({ ...snapshot, content: '' })).toThrow();
    expect(() => Topic.hydrate({ ...snapshot, version: 0 })).toThrow();
  });

  it('el token de versión es la forma decimal de `version`', () => {
    expect(create().versionToken).toBe('1');
  });
});
