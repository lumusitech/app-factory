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
  return `/courses/${courseId}/period-closings/${period}`;
}

async function createEvaluation(id: string, period = 'C1'): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/courses/curso-3-1/evaluations',
    headers: { 'x-tenant': TENANT },
    payload: { id, name: 'Parcial 1', period, weight: 1 },
  });
  expect(response.statusCode).toBe(201);
}

describe('cierre de período — borde HTTP (F-12; D22: bordes y rutas críticas)', () => {
  it('fija la hoja de overrides (ordenada, versión 1) y persiste filas + outbox en la misma transacción', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: {
        entries: [
          { studentId: 'legajo-2', value: 8, motive: 'Recuperó el TP' },
          { studentId: 'legajo-1', value: 7 },
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
          { studentId: 'legajo-1', value: 7, motive: null },
          { studentId: 'legajo-2', value: 8, motive: 'Recuperó el TP' },
        ],
        version: 1,
      },
    });
    expect(await count('period_closing')).toBe(1);
    expect(await count('period_closing_entry')).toBe(2);
    expect(await count('outbox')).toBe(1);
    const { rows } = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM period_closing');
    expect(rows[0]?.tenant_id).toBe(TENANT);
  });

  it('reemplaza la hoja (versión 2) con `X-Sync-Base-Version`', async () => {
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    });

    const second = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 9, motive: 'Subió' }] },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      data: { version: 2, entries: [{ studentId: 'legajo-1', value: 9, motive: 'Subió' }] },
    });
    expect(await count('period_closing')).toBe(1);
    expect(await count('period_closing_entry')).toBe(1);
  });

  it('borde `lww`: la escritura obsoleta se aplica y devuelve la señal de sobrescritura', async () => {
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    });
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 8 }] },
    });

    const stale = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 10 }] },
    });

    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({ data: { version: 3 } });
    expect(stale.json<{ sync?: Record<string, unknown> }>().sync).toMatchObject({
      previousVersion: '2',
      actor: 'dev-user',
    });
  });

  it('borde: valor fuera de rango (0 y 11), no entero, alumno duplicado o período vacío → 400', async () => {
    for (const payload of [
      { entries: [{ studentId: 'legajo-1', value: 0 }] },
      { entries: [{ studentId: 'legajo-1', value: 11 }] },
      { entries: [{ studentId: 'legajo-1', value: 7.5 }] },
      {
        entries: [
          { studentId: 'legajo-1', value: 7 },
          { studentId: 'legajo-1', value: 8 },
        ],
      },
      { entries: [{ studentId: '   ', value: 7 }] },
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
      url: '/courses/curso-3-1/period-closings/%20',
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    });
    expect(emptyPeriod.statusCode).toBe(400);
  });

  it('borde: acepta los límites de la escala (valor 1 y 10, T16) y una hoja vacía', async () => {
    const limits = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: {
        entries: [
          { studentId: 'legajo-1', value: 1 },
          { studentId: 'legajo-2', value: 10 },
        ],
      },
    });
    expect(limits.statusCode).toBe(200);

    const empty = await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [] },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ data: { entries: [], version: 2 } });
    expect(await count('period_closing_entry')).toBe(0);
  });

  it('borde: dos tenants con el mismo (curso, período) no colisionan', async () => {
    const payload = { entries: [{ studentId: 'legajo-1', value: 7 }] };
    const first = await app.inject({ method: 'PUT', url: url(), headers: { 'x-tenant': TENANT }, payload });
    const second = await app.inject({ method: 'PUT', url: url(), headers: { 'x-tenant': 'docente-2' }, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await count('period_closing')).toBe(2);
  });

  it('borde: sin identidad falla cerrada (SCOPE_MISSING)', async () => {
    const anonymous = await app.inject({
      method: 'PUT',
      url: url(),
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    });
    expect(anonymous.statusCode).toBe(500);
    expect(anonymous.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('reintento con la misma Idempotency-Key: replay sin duplicar', async () => {
    const request = {
      method: 'PUT' as const,
      url: url(),
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'op-closing-1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(await count('period_closing')).toBe(1);
    expect(await count('outbox')).toBe(1);
  });

  it('GET: deriva la nota automática (promedio simple), el override gana y se ve la evolución', async () => {
    await createEvaluation('e1', 'C1');
    await app.inject({
      method: 'PUT',
      url: '/evaluations/e1/grades',
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', value: 6 }] },
    });
    // La evolución documenta una recorrección (GradeSheet sigue siendo la nota vigente = 6).
    await app.inject({
      method: 'POST',
      url: '/students/legajo-1/records',
      headers: { 'x-tenant': TENANT },
      payload: {
        kind: 'evaluacion',
        evaluationId: 'e1',
        grade: 8,
        note: 'Reentrega',
        occurredOn: '2026-05-20',
      },
    });
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-2', value: 9, motive: 'Motivo' }] },
    });

    const response = await app.inject({ method: 'GET', url: url(), headers: { 'x-tenant': TENANT } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        courseId: 'curso-3-1',
        period: 'C1',
        students: [
          {
            studentId: 'legajo-1',
            automatic: 6,
            effective: 6,
            state: 'automatica',
            motive: null,
            evolution: [
              { evaluationId: 'e1', grade: 8, note: 'Reentrega', occurredOn: '2026-05-20' },
            ],
          },
          {
            studentId: 'legajo-2',
            automatic: null,
            effective: 9,
            state: 'manual',
            motive: 'Motivo',
            evolution: [],
          },
        ],
      },
    });
  });

  it('GET: período sin evaluaciones devuelve la vista vacía (sin 404)', async () => {
    const response = await app.inject({ method: 'GET', url: url(), headers: { 'x-tenant': TENANT } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { courseId: 'curso-3-1', period: 'C1', students: [] } });
  });

  it('GET: borde multi-tenant — no ve las notas ni el override de otro tenant', async () => {
    await app.inject({
      method: 'POST',
      url: '/courses/curso-3-1/evaluations',
      headers: { 'x-tenant': 'docente-2' },
      payload: { id: 'e2', name: 'Parcial', period: 'C1', weight: 1 },
    });
    await app.inject({
      method: 'PUT',
      url: '/evaluations/e2/grades',
      headers: { 'x-tenant': 'docente-2' },
      payload: { entries: [{ studentId: 'legajo-1', value: 10 }] },
    });
    await app.inject({
      method: 'PUT',
      url: url(),
      headers: { 'x-tenant': 'docente-2' },
      payload: { entries: [{ studentId: 'legajo-1', value: 10 }] },
    });

    const response = await app.inject({ method: 'GET', url: url(), headers: { 'x-tenant': TENANT } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { students: [] } });
  });

  it('GET: sin identidad falla cerrada (SCOPE_MISSING)', async () => {
    const anonymous = await app.inject({ method: 'GET', url: url() });
    expect(anonymous.statusCode).toBe(500);
    expect(anonymous.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });
});
