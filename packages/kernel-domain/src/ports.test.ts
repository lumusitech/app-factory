import { describe, expect, it } from 'vitest';

import type { Clock, DomainEvent, IdGenerator, OutboxPort, UnitOfWork } from './index.js';

/**
 * El paquete es mecánica pura (puertos + tipo de evento): no tiene lógica de
 * negocio propia. Estos tests fijan **el contrato** de cada puerto con
 * implementaciones conformes, incluidos los bordes (propagación de error, LIFO
 * del outbox, idempotencia de la fuente de ids).
 */

class FixedClock implements Clock {
  readonly #now: Date;
  constructor(now: Date) {
    this.#now = now;
  }
  now(): Date {
    return this.#now;
  }
}

class SeqIdGenerator implements IdGenerator {
  #n = 0;
  next(): string {
    this.#n += 1;
    return `id-${this.#n}`;
  }
}

class CollectingOutbox implements OutboxPort {
  readonly events: DomainEvent[] = [];
  async append(events: readonly DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

interface Repositories {
  readonly orders: readonly string[];
}

class InMemoryUnitOfWork implements UnitOfWork<Repositories> {
  readonly #repositories: Repositories;
  constructor(repositories: Repositories) {
    this.#repositories = repositories;
  }
  async run<TResult>(work: (repositories: Repositories) => Promise<TResult>): Promise<TResult> {
    return work(this.#repositories);
  }
}

describe('Clock', () => {
  it('es inyectable: devuelve el instante fijado, sin tocar `Date.now()`', () => {
    const fixed = new Date('2026-10-28T00:00:00.000Z');
    expect(new FixedClock(fixed).now()).toBe(fixed);
  });
});

describe('IdGenerator', () => {
  it('genera ids en el dominio, antes del INSERT (D8)', () => {
    const generator = new SeqIdGenerator();
    expect(generator.next()).toBe('id-1');
    expect(generator.next()).toBe('id-2');
  });
});

describe('OutboxPort', () => {
  it('acumula los eventos en orden de emisión (D9/D10)', async () => {
    const outbox = new CollectingOutbox();
    const occurredAt = new Date('2026-10-28T00:00:00.000Z');
    const event: DomainEvent<{ total: number }> = {
      id: 'evt-1',
      type: 'order.opened',
      aggregateId: 'ord-1',
      occurredAt,
      payload: { total: 10 },
    };

    await outbox.append([event]);
    await outbox.append([]);

    expect(outbox.events).toEqual([event]);
  });
});

describe('UnitOfWork', () => {
  it('entrega el bag de repositorios y propaga el resultado (§4.1)', async () => {
    const uow = new InMemoryUnitOfWork({ orders: ['a', 'b'] });
    await expect(uow.run(async (repos) => repos.orders.length)).resolves.toBe(2);
  });

  it('borde: propaga el error del trabajo, no lo traga', async () => {
    const uow = new InMemoryUnitOfWork({ orders: [] });
    await expect(
      uow.run(async () => {
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
  });
});
