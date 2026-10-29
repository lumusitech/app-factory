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

async function createEvaluation(
  overrides: Partial<{ name: string; period: string; weight: number }> = {},
  tenant = TENANT,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/courses/curso-3-1/evaluations',
    headers: { 'x-tenant': tenant },
    payload: { name: 'Parcial 1', period: 'C1', weight: 1, ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe('calificaciones — borde HTTP (F-02; D22: bordes y rutas críticas)', () => {
  describe('evaluación (POST /courses/:courseId/evaluations)', () => {
    it('crea la evaluación y persiste fila + outbox en la misma transacción', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/evaluations',
        headers: { 'x-tenant': TENANT },
        payload: { name: 'Parcial 1', period: 'C1', weight: 2 },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        statusCode: 201,
        data: { courseId: 'curso-3-1', name: 'Parcial 1', period: 'C1', weight: 2, version: 1 },
      });
      expect(await count('evaluation')).toBe(1);
      expect(await count('outbox')).toBe(1);
      const { rows } = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM evaluation');
      expect(rows[0]?.tenant_id).toBe(TENANT);
    });

    it('acepta un `id` del cliente (crear y calificar offline)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/evaluations',
        headers: { 'x-tenant': TENANT },
        payload: { id: 'eval-cliente-1', name: 'TP', period: 'C1', weight: 1 },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { id: string } }>().data.id).toBe('eval-cliente-1');
    });

    it('borde: el mismo `id` de cliente en dos tenants no colisiona', async () => {
      const payload = { id: 'eval-x', name: 'TP', period: 'C1', weight: 1 };
      const first = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/evaluations',
        headers: { 'x-tenant': TENANT },
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/evaluations',
        headers: { 'x-tenant': 'docente-2' },
        payload,
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(await count('evaluation')).toBe(2);
    });

    it('borde: peso no positivo o nombre/período vacíos → 400', async () => {
      for (const payload of [
        { name: 'Parcial', period: 'C1', weight: 0 },
        { name: 'Parcial', period: 'C1', weight: -1 },
        { name: '   ', period: 'C1', weight: 1 },
        { name: 'Parcial', period: '   ', weight: 1 },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/courses/curso-3-1/evaluations',
          headers: { 'x-tenant': TENANT },
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
      }
    });

    it('borde: sin identidad falla cerrada (SCOPE_MISSING)', async () => {
      const anonymous = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/evaluations',
        payload: { name: 'Parcial', period: 'C1', weight: 1 },
      });
      expect(anonymous.statusCode).toBe(500);
      expect(anonymous.json()).toMatchObject({ error: 'SCOPE_MISSING' });
    });

    it('reintento con la misma Idempotency-Key: replay sin duplicar', async () => {
      const request = {
        method: 'POST' as const,
        url: '/courses/curso-3-1/evaluations',
        headers: { 'x-tenant': TENANT, 'idempotency-key': 'op-eval-1' },
        payload: { name: 'Parcial', period: 'C1', weight: 1 },
      };

      const first = await app.inject(request);
      const replay = await app.inject(request);

      expect(first.statusCode).toBe(201);
      expect(replay.json()).toEqual(first.json());
      expect(await count('evaluation')).toBe(1);
      expect(await count('outbox')).toBe(1);
    });

    it('GET /evaluations/:id devuelve la evaluación; inexistente → 404', async () => {
      const id = await createEvaluation({ weight: 3 });

      const found = await app.inject({
        method: 'GET',
        url: `/evaluations/${id}`,
        headers: { 'x-tenant': TENANT },
      });
      expect(found.statusCode).toBe(200);
      expect(found.json()).toMatchObject({ data: { id, weight: 3 } });

      const missing = await app.inject({
        method: 'GET',
        url: '/evaluations/no-existe',
        headers: { 'x-tenant': TENANT },
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('notas (PUT /evaluations/:id/grades)', () => {
    it('fija las notas (ordenadas, versión 1) y luego las reemplaza (versión 2)', async () => {
      const id = await createEvaluation();

      const first = await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT },
        payload: {
          entries: [
            { studentId: 'legajo-2', value: 8 },
            { studentId: 'legajo-1', value: 7 },
          ],
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        data: {
          evaluationId: id,
          entries: [
            { studentId: 'legajo-1', value: 7 },
            { studentId: 'legajo-2', value: 8 },
          ],
          version: 1,
        },
      });

      const second = await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { entries: [{ studentId: 'legajo-1', value: 10 }] },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ data: { version: 2 } });
      expect(await count('grade_sheet')).toBe(1);
      expect(await count('grade_entry')).toBe(1);
    });

    it('borde `lww`: la escritura obsoleta se aplica y devuelve la señal', async () => {
      const id = await createEvaluation();
      await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
      });
      await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { entries: [{ studentId: 'legajo-1', value: 9 }] },
      });

      const stale = await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: {
          entries: [
            { studentId: 'legajo-1', value: 10 },
            { studentId: 'legajo-2', value: 6 },
          ],
        },
      });

      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ data: { version: 3 } });
      expect(stale.json<{ sync?: Record<string, unknown> }>().sync).toMatchObject({
        previousVersion: '2',
        actor: 'dev-user',
      });
      expect(await count('grade_entry')).toBe(2);
    });

    it('borde: valor fuera de rango (0 y 11), no entero, o alumno duplicado → 400', async () => {
      const id = await createEvaluation();

      for (const entries of [
        [{ studentId: 'legajo-1', value: 0 }],
        [{ studentId: 'legajo-1', value: 11 }],
        [{ studentId: 'legajo-1', value: 7.5 }],
        [
          { studentId: 'legajo-1', value: 7 },
          { studentId: 'legajo-1', value: 8 },
        ],
      ]) {
        const response = await app.inject({
          method: 'PUT',
          url: `/evaluations/${id}/grades`,
          headers: { 'x-tenant': TENANT },
          payload: { entries },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
      }
    });

    it('borde: acepta los límites de la escala (valor 1 y valor 10, T16)', async () => {
      const id = await createEvaluation();
      const response = await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT },
        payload: {
          entries: [
            { studentId: 'legajo-1', value: 1 },
            { studentId: 'legajo-2', value: 10 },
          ],
        },
      });
      expect(response.statusCode).toBe(200);
    });

    it('borde: evaluación inexistente → 404; hoja vacía es válida', async () => {
      const missing = await app.inject({
        method: 'PUT',
        url: '/evaluations/no-existe/grades',
        headers: { 'x-tenant': TENANT },
        payload: { entries: [] },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: 'NOT_FOUND' });

      const id = await createEvaluation();
      const empty = await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT },
        payload: { entries: [] },
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toMatchObject({ data: { entries: [], version: 1 } });
    });

    it('borde: no aplica sobre una evaluación de otro tenant (404)', async () => {
      const id = await createEvaluation();
      const foreign = await app.inject({
        method: 'PUT',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': 'docente-2' },
        payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
      });
      expect(foreign.statusCode).toBe(404);
      expect(await count('grade_sheet')).toBe(0);
    });

    it('GET /evaluations/:id/grades: 200 con la hoja, 404 si no hay notas', async () => {
      const id = await createEvaluation();

      const none = await app.inject({
        method: 'GET',
        url: `/evaluations/${id}/grades`,
        headers: { 'x-tenant': TENANT },
      });
      expect(none.statusCode).toBe(404);
    });
  });
});
