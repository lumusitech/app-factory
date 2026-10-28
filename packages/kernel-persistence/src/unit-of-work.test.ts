import { buildScope, runWithScope, ScopeMissingError } from '@kernel/scope';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqlConnection } from './executor.js';
import { createTestDb } from '../test-support/pglite.js';
import { PgUnitOfWork } from './unit-of-work.js';

import type { TestDb } from '../test-support/pglite.js';

const scopeOf = (tenantId: string) =>
  buildScope({ tenantId, actor: { kind: 'user', id: `user-${tenantId}` } });

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await db.executor.exec('CREATE TABLE sample_note (id text PRIMARY KEY, tenant_id text NOT NULL, title text NOT NULL)');
});

afterEach(async () => {
  await db.close();
});

describe('PgUnitOfWork (fail-closed, scope.md §6.2)', () => {
  it('sin alcance lanza ScopeMissingError y NO abre transacción', async () => {
    let opened = 0;
    const counted: SqlConnection = {
      transaction: (work) => {
        opened += 1;
        return db.connection.transaction(work);
      },
    };
    const uow = new PgUnitOfWork(counted, () => ({}));

    await expect(uow.run(async () => 0)).rejects.toBeInstanceOf(ScopeMissingError);
    expect(opened).toBe(0);
  });
});

describe('PgUnitOfWork (aplicación del alcance)', () => {
  it('fija `app.tenant_id` en la transacción desde el ScopeContext', async () => {
    const uow = new PgUnitOfWork(db.connection, (context) => context);

    const tenant = await runWithScope(scopeOf('t1'), () =>
      uow.run(async (context) => {
        const { rows } = await context.executor.query<{ tenant: string }>(
          "SELECT current_setting('app.tenant_id') AS tenant",
        );
        return rows[0]?.tenant;
      }),
    );

    expect(tenant).toBe('t1');
  });

  it('el trabajo se ejecuta dentro de la transacción y hace commit', async () => {
    const uow = new PgUnitOfWork(db.connection, (context) => context);

    await runWithScope(scopeOf('t1'), () =>
      uow.run(async (context) => {
        await context.executor.query(
          'INSERT INTO sample_note (id, tenant_id, title) VALUES ($1, $2, $3)',
          ['n1', context.tenantId, 'nota'],
        );
      }),
    );

    const { rows } = await db.executor.query<{ count: number }>('SELECT count(*)::int AS count FROM sample_note');
    expect(rows[0]?.count).toBe(1);
  });

  it('rollback: si el trabajo lanza, nada persiste', async () => {
    const uow = new PgUnitOfWork(db.connection, (context) => context);

    await expect(
      runWithScope(scopeOf('t1'), () =>
        uow.run(async (context) => {
          await context.executor.query(
            'INSERT INTO sample_note (id, tenant_id, title) VALUES ($1, $2, $3)',
            ['n1', context.tenantId, 'nota'],
          );
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');

    const { rows } = await db.executor.query<{ count: number }>('SELECT count(*)::int AS count FROM sample_note');
    expect(rows[0]?.count).toBe(0);
  });

  it('borde: el GUC es local y NO se filtra a la transacción siguiente', async () => {
    const uow = new PgUnitOfWork(db.connection, (context) => context);

    await runWithScope(scopeOf('t1'), () => uow.run(async () => undefined));

    const { rows } = await db.executor.query<{ tenant: string | null }>(
      "SELECT current_setting('app.tenant_id', true) AS tenant",
    );
    expect(rows[0]?.tenant === null || rows[0]?.tenant === '').toBe(true);
  });
});