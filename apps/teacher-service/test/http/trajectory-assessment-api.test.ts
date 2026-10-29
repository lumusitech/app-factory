import { PGlite } from '@electric-sql/pglite';
import { SystemClock, createPgliteConnection } from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { headerSessionResolver } from '../../src/identity.js';
import { runAppMigrations } from '../../src/migrations.js';

const TENANT = 'docente-1';

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

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return rows[0]?.count ?? -1;
}

function url(courseId = 'curso-3-1', period = 'C1'): string {
  return `/courses/${courseId}/trajectory-assessments/${period}`;
}

describe('valoración preliminar — borde HTTP (F-03; D22: bordes y rutas críticas)', () => {
  it('fija la hoja (ordenada por alumno, versión 1) y persiste filas + outbox en la misma transacción', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: {
        entries: [
          { studentId: 'legajo-2', rating: 'TEP' },
          { studentId: 'legajo-1', rating: 'TEA' },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      statusCode: 200,
      data: {
        courseId: 'curso-3-1',
        period: 'C1',
        entries: [
          { studentId: 'legajo-1', rating: 'TEA' },
          { studentId: 'legajo-2', rating: 'TEP' },
        ],
        version: 1,
      },
    });
    expect(await count('trajectory_assessment')).toBe(1);
    expect(await count('trajectory_assessment_entry')).toBe(2);
    expect(await count('outbox')).toBe(1);
    const { rows } = await db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM trajectory_assessment',
    );
    expect(rows[0]?.tenant_id).toBe(TENANT);
  });

  it('reemplaza la hoja (versión 2) con `X-Sync-Base-Version`', async () => {
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEP' }] },
    });

    const second = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TED' }] },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ data: { version: 2, entries: [{ studentId: 'legajo-1', rating: 'TED' }] } });
    expect(await count('trajectory_assessment')).toBe(1);
    expect(await count('trajectory_assessment_entry')).toBe(1);
  });

  it('borde `lww`: la escritura obsoleta se aplica y devuelve la señal de sobrescritura', async () => {
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] },
    });
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEP' }] },
    });

    const stale = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TED' }] },
    });

    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ data: { version: 3 } });
    expect(stale.json<{ sync?: Record<string, unknown> }>().sync).toMatchObject({
      previousVersion: '2',
      actor: 'dev-user',
    });
  });

  it('borde: rating fuera del enum, alumno duplicado o período vacío → 400', async () => {
    for (const payload of [
      { entries: [{ studentId: 'legajo-1', rating: 'Aprobado' }] },
      { entries: [{ studentId: 'legajo-1', rating: 'tea' }] },
      { entries: [{ studentId: 'legajo-1', rating: 'TEA' }, { studentId: 'legajo-1', rating: 'TED' }] },
      { entries: [{ studentId: '   ', rating: 'TEA' }] },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: url(),
        headers: { 'x-tenant': TENANT },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
    }

    const emptyPeriod = await app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/trajectory-assessments/%20',
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] },
    });
    expect(emptyPeriod.statusCode).toBe(400);
  });

  it('borde: una hoja sin alumnos es válida y limpia las valoraciones del período', async () => {
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] },
    });

    const empty = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [] },
    });

    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ data: { entries: [], version: 2 } });
    expect(await count('trajectory_assessment_entry')).toBe(0);
  });

  it('borde: dos tenants con el mismo (curso, período) no colisionan', async () => {
    const payload = { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] };
    const first = await app.inject({ method: 'PUT', url: url(), headers: { 'x-tenant': TENANT }, payload });
    const second = await app.inject({ method: 'PUT', url: url(), headers: { 'x-tenant': 'docente-2' }, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await count('trajectory_assessment')).toBe(2);
  });

  it('borde: sin identidad falla cerrada (SCOPE_MISSING)', async () => {
    const anonymous = await app.inject({
      method: 'PUT',
      url: url(),
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] },
    });
    expect(anonymous.statusCode).toBe(500);
    expect(anonymous.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('reintento con la misma Idempotency-Key: replay sin duplicar', async () => {
    const request = {
      method: 'PUT' as const,
      url: url(),
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'op-val-1' },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] },
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await count('trajectory_assessment')).toBe(1);
    expect(await count('outbox')).toBe(1);
  });

  it('GET /courses/:courseId/trajectory-assessments/:period: 200 con la hoja, 404 si no existe', async () => {
    const none = await app.inject({
      method: 'GET',
      url: url(),
      headers: { 'x-tenant': TENANT },
    });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toMatchObject({ error: 'NOT_FOUND' });

    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEP' }] },
    });

    const found = await app.inject({
      method: 'GET',
      url: url(),
      headers: { 'x-tenant': TENANT },
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ data: { entries: [{ studentId: 'legajo-1', rating: 'TEP' }] } });
  });
});
