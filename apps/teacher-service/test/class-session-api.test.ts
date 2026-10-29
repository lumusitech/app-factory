import { PGlite } from '@electric-sql/pglite';
import { SystemClock, createPgliteConnection } from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { headerSessionResolver } from '../src/identity.js';
import { runAppMigrations } from '../src/migrations.js';

const TENANT = 'docente-1';
const PAYLOAD = { courseId: 'curso-3-1', date: '2026-10-29' };

let app: FastifyInstance;
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  const connection = createPgliteConnection(db);
  await runAppMigrations(connection);
  app = await buildApp({ connection, clock: new SystemClock(), resolver: headerSessionResolver });
});

afterEach(async () => {
  await app.close();
  await db.close();
});

interface SessionData {
  readonly id: string;
  readonly courseId: string;
  readonly date: string;
  readonly status: string;
  readonly cancellationReason: string | null;
  readonly version: number;
}

async function createSession(): Promise<{ id: string; version: number; statusCode: number }> {
  const response = await app.inject({
    method: 'POST',
    url: '/class-sessions',
    headers: { 'x-tenant': TENANT },
    payload: PAYLOAD,
  });
  const body = response.json<{ data: SessionData }>();
  return { id: body.data.id, version: body.data.version, statusCode: response.statusCode };
}

async function count(table: 'class_session' | 'outbox'): Promise<number> {
  const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return rows[0]?.count ?? -1;
}

describe('class-sessions — borde HTTP (D22: bordes y rutas críticas)', () => {
  it('crea la clase y persiste fila + outbox en la misma transacción', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT },
      payload: PAYLOAD,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      statusCode: 201,
      data: {
        courseId: 'curso-3-1',
        date: '2026-10-29',
        status: 'dictada',
        cancellationReason: null,
        version: 1,
      },
    });

    expect(await count('class_session')).toBe(1);
    expect(await count('outbox')).toBe(1);
    const { rows } = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM class_session');
    expect(rows[0]?.tenant_id).toBe(TENANT);
  });

  it('reintento con la misma Idempotency-Key: replay sin duplicar', async () => {
    const request = {
      method: 'POST' as const,
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'op-create-1' },
      payload: PAYLOAD,
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await count('class_session')).toBe(1);
    expect(await count('outbox')).toBe(1);
  });

  it('borde: misma Idempotency-Key con payload distinto → 409', async () => {
    const headers = { 'x-tenant': TENANT, 'idempotency-key': 'op-create-2' };
    await app.inject({ method: 'POST', url: '/class-sessions', headers, payload: PAYLOAD });

    const conflict = await app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers,
      payload: { ...PAYLOAD, date: '2026-10-30' },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
    expect(await count('class_session')).toBe(1);
  });

  it('borde: body inválido (falta `date`) y fecha imposible → 400', async () => {
    const missingDate = await app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT },
      payload: { courseId: 'curso-3-1' },
    });
    expect(missingDate.statusCode).toBe(400);
    expect(missingDate.json()).toMatchObject({ error: 'VALIDATION_ERROR' });

    const impossibleDate = await app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT },
      payload: { courseId: 'curso-3-1', date: '2026-02-30' },
    });
    expect(impossibleDate.statusCode).toBe(400);
    expect(impossibleDate.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('borde: lectura cross-tenant no devuelve datos ajenos (404)', async () => {
    const { id } = await createSession();

    const own = await app.inject({
      method: 'GET',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT },
    });
    expect(own.statusCode).toBe(200);

    const foreign = await app.inject({
      method: 'GET',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': 'docente-2' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('borde: sin identidad, una ruta de tenant falla cerrada (SCOPE_MISSING)', async () => {
    const { id } = await createSession();

    const anonymous = await app.inject({ method: 'GET', url: `/class-sessions/${id}` });
    expect(anonymous.statusCode).toBe(500);
    expect(anonymous.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('borde: leer una clase inexistente → 404', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/class-sessions/no-existe',
      headers: { 'x-tenant': TENANT },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('borde: cancelar sin motivo → 400 (validación de borde)', async () => {
    const { id } = await createSession();

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT },
      payload: { status: 'cancelada' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('cancela con la versión vigente: aplica sin señal y sube la versión', async () => {
    const { id, version } = await createSession();

    const patched = await app.inject({
      method: 'PATCH',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': String(version) },
      payload: { status: 'cancelada', cancellationReason: 'paro' },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      data: { status: 'cancelada', cancellationReason: 'paro', version: 2 },
    });
    expect(patched.json<{ sync?: unknown }>().sync).toBeUndefined();
  });

  it('borde `lww`: escritura obsoleta se aplica y devuelve la señal de sobrescritura', async () => {
    const { id } = await createSession();

    // El servidor avanza a la versión 2.
    await app.inject({
      method: 'PATCH',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { status: 'feriado' },
    });

    // El cliente parte de la versión 1 (obsoleta): la última escritura gana.
    const stale = await app.inject({
      method: 'PATCH',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { status: 'cancelada', cancellationReason: 'paro' },
    });

    expect(stale.statusCode).toBe(200);
    const body = stale.json<{ data: SessionData; sync?: Record<string, unknown> }>();
    expect(body.data).toMatchObject({ status: 'cancelada', version: 3 });
    expect(body.sync).toMatchObject({ previousVersion: '2', actor: 'dev-user' });
  });

  it('borde: sin `baseVersion` la operación no versiona y se aplica', async () => {
    const { id } = await createSession();

    const patched = await app.inject({
      method: 'PATCH',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT },
      payload: { status: 'sin_clase' },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ data: { status: 'sin_clase', version: 2 } });
  });

  it('borde: PATCH cross-tenant no aplica sobre datos ajenos (404)', async () => {
    const { id } = await createSession();

    const foreign = await app.inject({
      method: 'PATCH',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': 'docente-2' },
      payload: { status: 'feriado' },
    });
    expect(foreign.statusCode).toBe(404);
    expect(await count('class_session')).toBe(1);
  });
});
