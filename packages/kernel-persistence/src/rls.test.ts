import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test-support/pglite.js';
import type { TestDb } from '../test-support/pglite.js';

const OCCURRED_AT = new Date('2026-10-28T12:00:00.000Z');

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();

  // Sembrar dos tenants como dueño (el dueño/superusuario no está sujeto a RLS).
  await db.executor.query(
    `INSERT INTO outbox (id, tenant_id, type, aggregate_id, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb), ($7, $8, $9, $10, $11, $12::jsonb)`,
    [
      'e-a',
      'tenant-a',
      'sample-note.created',
      'note-a',
      OCCURRED_AT,
      JSON.stringify({ tenant: 'a' }),
      'e-b',
      'tenant-b',
      'sample-note.created',
      'note-b',
      OCCURRED_AT,
      JSON.stringify({ tenant: 'b' }),
    ],
  );

  // Rol no-dueño: es a quien la RLS sí le aplica (el backstop de D12).
  await db.executor.exec(
    'CREATE ROLE app_runtime NOLOGIN; GRANT SELECT, INSERT ON outbox TO app_runtime; SET ROLE app_runtime;',
  );
});

afterEach(async () => {
  await db.close();
});

describe('backstop RLS (D12, scope.md §6.3/§9)', () => {
  it('con `app.tenant_id` fijado, la base solo devuelve las filas de ese tenant', async () => {
    const rows = await db.connection.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", ['tenant-a']);
      const result = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM outbox');
      return result.rows;
    });

    expect(rows.map((row) => row.tenant_id)).toEqual(['tenant-a']);
  });

  it('borde: sin `app.tenant_id` la base NO devuelve ninguna fila (fail-closed)', async () => {
    const rows = await db.connection.transaction(async (tx) => {
      const result = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM outbox');
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it('borde: la política WITH CHECK impide insertar datos de otro tenant', async () => {
    await expect(
      db.connection.transaction(async (tx) => {
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", ['tenant-a']);
        await tx.query(
          `INSERT INTO outbox (id, tenant_id, type, aggregate_id, occurred_at, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          ['e-x', 'tenant-b', 'sample-note.created', 'note-x', OCCURRED_AT, JSON.stringify({})],
        );
      }),
    ).rejects.toThrow();
  });
});