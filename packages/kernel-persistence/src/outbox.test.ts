import type { DomainEvent } from '@kernel/domain';
import { buildScope, runWithScope } from '@kernel/scope';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test-support/pglite.js';
import type { TestDb } from '../test-support/pglite.js';
import { OutboxPublisher, PgOutboxPort } from './outbox.js';
import { PgUnitOfWork } from './unit-of-work.js';

const scopeOf = (tenantId: string) =>
  buildScope({ tenantId, actor: { kind: 'user', id: `user-${tenantId}` } });

const anEvent = (id: string, title = 'x'): DomainEvent => ({
  id,
  type: 'sample-note.created',
  aggregateId: 'note-1',
  occurredAt: new Date('2026-10-28T12:00:00.000Z'),
  payload: { title },
});

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await db.executor.exec(
    'CREATE TABLE sample_note (id text PRIMARY KEY, tenant_id text NOT NULL, title text NOT NULL)',
  );
});

afterEach(async () => {
  await db.close();
});

describe('PgOutboxPort (misma transacción que el agregado, D9/D10)', () => {
  it('escribe el evento con el tenant del ScopeContext en la transacción del agregado', async () => {
    const uow = new PgUnitOfWork(db.connection, (context) => ({
      context,
      outbox: new PgOutboxPort(context),
    }));

    await runWithScope(scopeOf('t1'), () =>
      uow.run(async ({ context, outbox }) => {
        await context.executor.query(
          'INSERT INTO sample_note (id, tenant_id, title) VALUES ($1, $2, $3)',
          ['note-1', context.tenantId, 'nota'],
        );
        await outbox.append([anEvent('e1', 'hola')]);
      }),
    );

    const { rows } = await db.executor.query<{
      tenant_id: string;
      type: string;
      aggregate_id: string;
      payload: { title: string };
    }>('SELECT tenant_id, type, aggregate_id, payload FROM outbox');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe('t1');
    expect(rows[0]?.type).toBe('sample-note.created');
    expect(rows[0]?.aggregate_id).toBe('note-1');
    expect(rows[0]?.payload).toEqual({ title: 'hola' });
  });

  it('rollback: si la transacción falla, ni el agregado ni el evento persisten', async () => {
    const uow = new PgUnitOfWork(db.connection, (context) => ({
      context,
      outbox: new PgOutboxPort(context),
    }));

    await expect(
      runWithScope(scopeOf('t1'), () =>
        uow.run(async ({ context, outbox }) => {
          await context.executor.query(
            'INSERT INTO sample_note (id, tenant_id, title) VALUES ($1, $2, $3)',
            ['note-1', context.tenantId, 'nota'],
          );
          await outbox.append([anEvent('e1')]);
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');

    const outbox = await db.executor.query<{ count: number }>('SELECT count(*)::int AS count FROM outbox');
    const notes = await db.executor.query<{ count: number }>('SELECT count(*)::int AS count FROM sample_note');
    expect(outbox.rows[0]?.count).toBe(0);
    expect(notes.rows[0]?.count).toBe(0);
  });
});

describe('OutboxPublisher (después del commit)', () => {
  it('despacha a todos los subscribers y permite desuscribir', async () => {
    const publisher = new OutboxPublisher();
    const received: string[] = [];
    const unsubscribe = publisher.subscribe((event) => {
      received.push(event.id);
    });
    publisher.subscribe((event) => {
      received.push(`second:${event.id}`);
    });

    await publisher.publish([anEvent('e1'), anEvent('e2')]);
    expect(received).toEqual(['e1', 'second:e1', 'e2', 'second:e2']);

    unsubscribe();
    await publisher.publish([anEvent('e3')]);
    expect(received).toEqual(['e1', 'second:e1', 'e2', 'second:e2', 'second:e3']);
  });

  it('borde: un listener que falla no pierde el evento ni impide a los demás', async () => {
    const publisher = new OutboxPublisher();
    const received: string[] = [];
    publisher.subscribe(() => {
      throw new Error('listener roto');
    });
    publisher.subscribe((event) => {
      received.push(event.id);
    });

    const failures = await publisher.publish([anEvent('e1')]);

    expect(received).toEqual(['e1']);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.eventId).toBe('e1');
  });
});