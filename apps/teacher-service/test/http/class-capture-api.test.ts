import { PGlite } from '@electric-sql/pglite';
import { SystemClock, createPgliteConnection } from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { headerSessionResolver } from '../../src/identity.js';
import { runAppMigrations } from '../../src/migrations.js';

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

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return rows[0]?.count ?? -1;
}

async function createSession(tenant = TENANT): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/class-sessions',
    headers: { 'x-tenant': tenant },
    payload: PAYLOAD,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe('captura de clase — borde HTTP (F-01; D22: bordes y rutas críticas)', () => {
  describe('tema del plan (POST /courses/:courseId/topics)', () => {
    it('crea el tema y persiste fila + outbox en la misma transacción', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': TENANT },
        payload: { order: 1, content: 'Ecuaciones' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        statusCode: 201,
        data: { courseId: 'curso-3-1', order: 1, content: 'Ecuaciones', version: 1 },
      });
      expect(await count('topic')).toBe(1);
      expect(await count('outbox')).toBe(1);
      const { rows } = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM topic');
      expect(rows[0]?.tenant_id).toBe(TENANT);
    });

    it('acepta un `id` del cliente (crear y vincular offline)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': TENANT },
        payload: { id: 'tema-cliente-1', order: 2, content: 'Tema' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<{ data: { id: string } }>().data.id).toBe('tema-cliente-1');
    });

    it('borde: el mismo `id` de cliente en dos tenants no colisiona', async () => {
      const payload = { id: 'tema-x', order: 1, content: 'Tema' };

      const first = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': TENANT },
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': 'docente-2' },
        payload,
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(await count('topic')).toBe(2);
    });

    it('borde: `order` inválido o contenido vacío → 400', async () => {
      const badOrder = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': TENANT },
        payload: { order: 0, content: 'Tema' },
      });
      expect(badOrder.statusCode).toBe(400);
      expect(badOrder.json()).toMatchObject({ error: 'VALIDATION_ERROR' });

      const emptyContent = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': TENANT },
        payload: { order: 1, content: '   ' },
      });
      expect(emptyContent.statusCode).toBe(400);
    });

    it('borde: sin identidad falla cerrada (SCOPE_MISSING)', async () => {
      const anonymous = await app.inject({
        method: 'POST',
        url: '/courses/curso-3-1/topics',
        payload: { order: 1, content: 'Tema' },
      });
      expect(anonymous.statusCode).toBe(500);
      expect(anonymous.json()).toMatchObject({ error: 'SCOPE_MISSING' });
    });

    it('reintento con la misma Idempotency-Key: replay sin duplicar', async () => {
      const request = {
        method: 'POST' as const,
        url: '/courses/curso-3-1/topics',
        headers: { 'x-tenant': TENANT, 'idempotency-key': 'op-topic-1' },
        payload: { order: 1, content: 'Tema' },
      };

      const first = await app.inject(request);
      const replay = await app.inject(request);

      expect(first.statusCode).toBe(201);
      expect(replay.json()).toEqual(first.json());
      expect(await count('topic')).toBe(1);
      expect(await count('outbox')).toBe(1);
    });
  });

  describe('tema dictado (PUT /class-sessions/:id/topic)', () => {
    it('fija el tema (versión 1) y luego lo cambia (versión 2)', async () => {
      const id = await createSession();

      const first = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/topic`,
        headers: { 'x-tenant': TENANT },
        payload: { topicId: 'tema-1' },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ data: { classSessionId: id, topicId: 'tema-1', version: 1 } });

      const second = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/topic`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { topicId: 'tema-2' },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ data: { topicId: 'tema-2', version: 2 } });
      expect(second.json<{ sync?: unknown }>().sync).toBeUndefined();
      expect(await count('class_topic')).toBe(1);
    });

    it('borde `lww`: escritura obsoleta se aplica y devuelve la señal', async () => {
      const id = await createSession();
      await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/topic`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { topicId: 'tema-1' },
      });
      await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/topic`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { topicId: 'tema-2' },
      });

      const stale = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/topic`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { topicId: 'tema-3' },
      });

      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ data: { topicId: 'tema-3', version: 3 } });
      expect(stale.json<{ sync?: Record<string, unknown> }>().sync).toMatchObject({
        previousVersion: '2',
        actor: 'dev-user',
      });
    });

    it('borde: tema inexistente → 404; `topicId` vacío → 400', async () => {
      const id = await createSession();

      const missingClass = await app.inject({
        method: 'PUT',
        url: '/class-sessions/no-existe/topic',
        headers: { 'x-tenant': TENANT },
        payload: { topicId: 'tema-1' },
      });
      expect(missingClass.statusCode).toBe(404);
      expect(missingClass.json()).toMatchObject({ error: 'NOT_FOUND' });

      const emptyTopic = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/topic`,
        headers: { 'x-tenant': TENANT },
        payload: { topicId: '   ' },
      });
      expect(emptyTopic.statusCode).toBe(400);
    });
  });

  describe('tarea (POST /class-sessions/:id/assignments)', () => {
    it('crea varias tareas de la clase, con `topicId` opcional', async () => {
      const id = await createSession();

      const first = await app.inject({
        method: 'POST',
        url: `/class-sessions/${id}/assignments`,
        headers: { 'x-tenant': TENANT },
        payload: { content: 'Ejercicios 1 al 5' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/class-sessions/${id}/assignments`,
        headers: { 'x-tenant': TENANT },
        payload: { content: 'Leer el capítulo 2', topicId: 'tema-1' },
      });

      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ data: { topicId: null, version: 1 } });
      expect(second.statusCode).toBe(201);
      expect(second.json()).toMatchObject({ data: { topicId: 'tema-1' } });
      expect(await count('assignment')).toBe(2);
    });

    it('borde: clase inexistente → 404; contenido vacío → 400', async () => {
      const missingClass = await app.inject({
        method: 'POST',
        url: '/class-sessions/no-existe/assignments',
        headers: { 'x-tenant': TENANT },
        payload: { content: 'Consigna' },
      });
      expect(missingClass.statusCode).toBe(404);

      const id = await createSession();
      const emptyContent = await app.inject({
        method: 'POST',
        url: `/class-sessions/${id}/assignments`,
        headers: { 'x-tenant': TENANT },
        payload: { content: '   ' },
      });
      expect(emptyContent.statusCode).toBe(400);
    });
  });

  describe('asistencia (PUT /class-sessions/:id/attendance)', () => {
    it('fija la asistencia (ordenada, versión 1) y luego la reemplaza (versión 2)', async () => {
      const id = await createSession();

      const first = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT },
        payload: {
          entries: [
            { studentId: 'legajo-2', status: 'ausente' },
            { studentId: 'legajo-1', status: 'presente' },
          ],
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        data: {
          classSessionId: id,
          entries: [
            { studentId: 'legajo-1', status: 'presente' },
            { studentId: 'legajo-2', status: 'ausente' },
          ],
          version: 1,
        },
      });

      const second = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { entries: [{ studentId: 'legajo-1', status: 'tarde' }] },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ data: { version: 2 } });
      expect(await count('class_attendance')).toBe(1);
      expect(await count('attendance_entry')).toBe(1);
    });

    it('borde `lww`: la escritura obsoleta se aplica, reemplaza la hoja y devuelve la señal', async () => {
      const id = await createSession();
      await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { entries: [{ studentId: 'legajo-1', status: 'presente' }] },
      });
      await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: { entries: [{ studentId: 'legajo-1', status: 'ausente' }] },
      });

      const stale = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
        payload: {
          entries: [
            { studentId: 'legajo-1', status: 'justificada' },
            { studentId: 'legajo-2', status: 'retirado' },
          ],
        },
      });

      expect(stale.statusCode).toBe(200);
      expect(stale.json()).toMatchObject({ data: { version: 3 } });
      expect(stale.json<{ sync?: Record<string, unknown> }>().sync).toMatchObject({
        previousVersion: '2',
      });
      expect(await count('attendance_entry')).toBe(2);
    });

    it('borde: alumno duplicado, estado inválido o clase inexistente', async () => {
      const id = await createSession();

      const duplicate = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT },
        payload: {
          entries: [
            { studentId: 'legajo-1', status: 'presente' },
            { studentId: 'legajo-1', status: 'ausente' },
          ],
        },
      });
      expect(duplicate.statusCode).toBe(400);
      expect(duplicate.json()).toMatchObject({ error: 'VALIDATION_ERROR' });

      const invalidStatus = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT },
        payload: { entries: [{ studentId: 'legajo-1', status: 'falto' }] },
      });
      expect(invalidStatus.statusCode).toBe(400);

      const missingClass = await app.inject({
        method: 'PUT',
        url: '/class-sessions/no-existe/attendance',
        headers: { 'x-tenant': TENANT },
        payload: { entries: [] },
      });
      expect(missingClass.statusCode).toBe(404);
    });

    it('borde: una clase sin alumnos es válida (hoja vacía)', async () => {
      const id = await createSession();
      const response = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': TENANT },
        payload: { entries: [] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { entries: [], version: 1 } });
    });

    it('borde: no aplica sobre una clase de otro tenant (404)', async () => {
      const id = await createSession();
      const foreign = await app.inject({
        method: 'PUT',
        url: `/class-sessions/${id}/attendance`,
        headers: { 'x-tenant': 'docente-2' },
        payload: { entries: [{ studentId: 'legajo-1', status: 'presente' }] },
      });
      expect(foreign.statusCode).toBe(404);
      expect(await count('class_attendance')).toBe(0);
    });
  });
});
