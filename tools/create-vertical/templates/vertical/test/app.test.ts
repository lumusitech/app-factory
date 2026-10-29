import { PGlite } from '@electric-sql/pglite';
import { SystemClock, createPgliteConnection } from '@kernel/persistence';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { headerSessionResolver } from '../src/identity.js';
import { runAppMigrations } from '../src/migrations.js';

let app: FastifyInstance;
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  const connection = createPgliteConnection(db);
  await runAppMigrations(connection);

  app = await buildApp({ connection, clock: new SystemClock(), resolver: headerSessionResolver });

  // Ruta de prueba que **consume** el alcance: prueba que el cableado funciona.
  app.get('/__scope', async () => ({ tenantId: requireScope().tenantId }));
});

afterEach(async () => {
  await app.close();
  await db.close();
});

describe('vertical recién generada: cableada al kernel', () => {
  it('expone el probe sin alcance (envelope)', async () => {
    const response = await app.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { status: 'ok' } });
  });

  it('borde: sin identidad, una ruta de tenant falla cerrada (SCOPE_MISSING)', async () => {
    const response = await app.inject({ method: 'GET', url: '/__scope' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('con identidad, el alcance se puebla con el tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__scope',
      headers: { 'x-tenant': 'tenant-a' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: 'tenant-a' });
  });

  it('aplica las migraciones del kernel (persistencia cableada)', async () => {
    const { rows } = await db.query<{ owner: string }>(
      'SELECT DISTINCT owner FROM schema_migrations ORDER BY owner',
    );
    expect(rows.map((row) => row.owner)).toContain('kernel-persistence');
  });
});
