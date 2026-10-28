import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  createPgConnection,
  createPgExecutor,
  createPgliteConnection,
  createPgliteExecutor,
} from './executor.js';

describe('createPgliteExecutor', () => {
  it('query parametrizada devuelve las filas', async () => {
    const db = new PGlite();
    const { rows } = await createPgliteExecutor(db).query<{ answer: number }>(
      'SELECT $1::int AS answer',
      [42],
    );
    expect(rows[0]?.answer).toBe(42);
    await db.close();
  });

  it('exec aplica un script de varias sentencias (necesario para migraciones)', async () => {
    const db = new PGlite();
    const executor = createPgliteExecutor(db);
    await executor.exec('CREATE TABLE t (id int); INSERT INTO t (id) VALUES (1), (2);');
    const { rows } = await executor.query<{ count: number }>('SELECT count(*)::int AS count FROM t');
    expect(rows[0]?.count).toBe(2);
    await db.close();
  });
});

describe('createPgliteConnection', () => {
  it('hace commit cuando el trabajo resuelve', async () => {
    const db = new PGlite();
    const connection = createPgliteConnection(db);
    await connection.transaction(async (tx) => {
      await tx.exec('CREATE TABLE t (id int)');
    });
    await connection.transaction(async (tx) => {
      await tx.exec('INSERT INTO t (id) VALUES (1)');
    });
    const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM t');
    expect(rows[0]?.count).toBe(1);
    await db.close();
  });

  it('hace rollback cuando el trabajo lanza', async () => {
    const db = new PGlite();
    const connection = createPgliteConnection(db);
    await connection.transaction(async (tx) => {
      await tx.exec('CREATE TABLE t (id int)');
    });
    await expect(
      connection.transaction(async (tx) => {
        await tx.exec('INSERT INTO t (id) VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM t');
    expect(rows[0]?.count).toBe(0);
    await db.close();
  });
});

type RecordedQuery = { readonly text: string; readonly params: readonly unknown[] | undefined };

function createFakePgClient(rows: readonly unknown[] = []) {
  const queries: RecordedQuery[] = [];
  let released = false;

  const client = {
    async query<TRow extends Record<string, unknown>>(text: string, params?: readonly unknown[]) {
      queries.push({ text, params });
      return { rows } as { rows: TRow[] };
    },
    release() {
      released = true;
    },
  };

  return { client, queries, wasReleased: () => released };
}

describe('createPgExecutor (fake del driver pg)', () => {
  it('forwardea el texto, los parámetros y las filas', async () => {
    const { client, queries } = createFakePgClient([{ id: 'n1' }]);
    const { rows } = await createPgExecutor(client).query('SELECT * FROM t WHERE id = $1', ['n1']);
    expect(queries).toEqual([{ text: 'SELECT * FROM t WHERE id = $1', params: ['n1'] }]);
    expect(rows[0]).toEqual({ id: 'n1' });
  });

  it('exec delega en el cliente (script sin parámetros)', async () => {
    const { client, queries } = createFakePgClient();
    await createPgExecutor(client).exec('CREATE TABLE t (id int)');
    expect(queries).toEqual([{ text: 'CREATE TABLE t (id int)', params: undefined }]);
  });
});

describe('createPgConnection (fake del driver pg)', () => {
  it('hace BEGIN/COMMIT y libera el cliente en el camino feliz', async () => {
    const { client, queries, wasReleased } = createFakePgClient();
    const pool = { connect: async () => client };
    const result = await createPgConnection(pool).transaction(async () => 'ok');
    expect(result).toBe('ok');
    expect(queries.map((q) => q.text)).toEqual(['BEGIN', 'COMMIT']);
    expect(wasReleased()).toBe(true);
  });

  it('hace ROLLBACK y libera el cliente si el trabajo lanza', async () => {
    const { client, queries, wasReleased } = createFakePgClient();
    const pool = { connect: async () => client };
    await expect(
      createPgConnection(pool).transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(queries.map((q) => q.text)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(wasReleased()).toBe(true);
  });
});