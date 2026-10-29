import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

const PAYLOAD = { courseId: 'curso-3-1', date: '2026-10-29' };

async function createSession(harness: TeacherSyncHarness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/class-sessions',
    headers: { 'x-tenant': TENANT },
    payload: PAYLOAD,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

async function count(harness: TeacherSyncHarness, table: string): Promise<number> {
  const { rows } = await harness.db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return rows[0]?.count ?? -1;
}

/**
 * Captura offline de F-01 (asistencia, tema y tarea) sobre la cola del kernel
 * (`docs/teacher-service-context.md` §8, T10; `docs/contracts/sync.md`).
 */
describe('captura offline de F-01 (asistencia, tema y tarea)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('la fachada traduce a items de la cola (método, ruta, baseVersion)', async () => {
    const item = await harness.sync.captureClassTopic({
      classSessionId: 's1',
      topicId: 't1',
      baseVersion: '7',
      idempotencyKey: 'k1',
    });
    expect(item).toMatchObject({
      method: 'PUT',
      path: '/class-sessions/s1/topic',
      baseVersion: '7',
      idempotencyKey: 'k1',
    });
  });

  it('converge: tema + tema dictado + asistencia + tarea capturados offline', async () => {
    const id = await createSession(harness);

    // 1. Offline: se captura el ritual completo; el primer item corta.
    harness.transport.online = false;
    await harness.sync.captureTopic({
      courseId: 'curso-3-1',
      order: 1,
      content: 'Ecuaciones',
      id: 'tema-cli-1',
      idempotencyKey: 't-1',
    });
    await harness.sync.captureClassTopic({
      classSessionId: id,
      topicId: 'tema-cli-1',
      idempotencyKey: 'ct-1',
    });
    await harness.sync.captureAttendance({
      classSessionId: id,
      entries: [
        { studentId: 'legajo-1', status: 'presente' },
        { studentId: 'legajo-2', status: 'ausente' },
      ],
      idempotencyKey: 'a-1',
    });
    await harness.sync.captureAssignment({
      classSessionId: id,
      content: 'Ejercicios 1 al 5',
      topicId: 'tema-cli-1',
      idempotencyKey: 'as-1',
    });

    const offline = await harness.client.flush();
    expect(offline.cut).toBe(true);
    expect(offline.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await count(harness, 'topic')).toBe(0);
    expect(await count(harness, 'class_topic')).toBe(0);
    expect(await count(harness, 'class_attendance')).toBe(0);
    expect(await count(harness, 'assignment')).toBe(0);

    // 2. Reconecta: FIFO aplica los cuatro items y la cola queda vacía.
    harness.transport.online = true;
    const online = await harness.client.flush();
    expect(online.cut).toBe(false);
    expect(online.outcomes.map((outcome) => outcome.result)).toEqual([
      'removed',
      'removed',
      'removed',
      'removed',
    ]);
    expect(await harness.client.list()).toHaveLength(0);

    // 3. Converge: cada pieza quedó persistida en su tenant.
    expect(await count(harness, 'topic')).toBe(1);
    expect(await count(harness, 'class_topic')).toBe(1);
    expect(await count(harness, 'class_attendance')).toBe(1);
    expect(await count(harness, 'attendance_entry')).toBe(2);
    expect(await count(harness, 'assignment')).toBe(1);

    const topic = await harness.db.query<{ id: string; order_index: number }>(
      'SELECT id, order_index FROM topic',
    );
    expect(topic.rows[0]).toMatchObject({ id: 'tema-cli-1', order_index: 1 });

    const link = await harness.db.query<{ topic_id: string }>(
      'SELECT topic_id FROM class_topic',
    );
    expect(link.rows[0]?.topic_id).toBe('tema-cli-1');

    // 4. Outbox: la clase (online) + las cuatro capturas offline.
    expect(await count(harness, 'outbox')).toBe(5);
  });

  it('borde: tema creado y vinculado en la misma sesión offline (id del cliente)', async () => {
    const id = await createSession(harness);

    harness.transport.online = false;
    await harness.sync.captureTopic({
      courseId: 'curso-3-1',
      order: 2,
      content: 'Sistemas de ecuaciones',
      id: 'tema-cli-2',
      idempotencyKey: 'same-1',
    });
    await harness.sync.captureClassTopic({
      classSessionId: id,
      topicId: 'tema-cli-2',
      idempotencyKey: 'same-2',
    });

    harness.transport.online = true;
    const report = await harness.client.flush();

    expect(report.cut).toBe(false);
    const link = await harness.db.query<{ topic_id: string }>('SELECT topic_id FROM class_topic');
    expect(link.rows[0]?.topic_id).toBe('tema-cli-2');
  });

  it('400 (validación): el item queda `blocked`, visible, y NO se descarta', async () => {
    await harness.sync.captureTopic({
      courseId: 'curso-3-1',
      order: 0,
      content: 'Tema',
      idempotencyKey: 'bad-topic',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    const items = await harness.client.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.state).toBe('blocked');
    expect(await count(harness, 'topic')).toBe(0);
  });

  it('401 (sesión inválida): la asistencia queda `blocked`', async () => {
    await harness.sync.captureAttendance({
      classSessionId: 'expired-session',
      entries: [],
      idempotencyKey: 'auth-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('5xx: el item se conserva y el flush corta (no envía el siguiente)', async () => {
    await harness.sync.captureAttendance({
      classSessionId: 'boom',
      entries: [],
      idempotencyKey: 'boom-1',
    });
    await harness.sync.captureTopic({
      courseId: 'curso-3-1',
      order: 1,
      content: 'Tema',
      idempotencyKey: 'boom-2',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect((await harness.client.list())[0]?.state).toBe('pending');
    expect(await count(harness, 'topic')).toBe(0);
  });

  it('conflicto `lww` en la asistencia: la última escritura gana con aviso', async () => {
    const id = await createSession(harness);

    // El servidor avanza la asistencia a la versión 2.
    await harness.app.inject({
      method: 'PUT',
      url: `/class-sessions/${id}/attendance`,
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', status: 'presente' }] },
    });
    await harness.app.inject({
      method: 'PUT',
      url: `/class-sessions/${id}/attendance`,
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', status: 'ausente' }] },
    });

    // Captura offline que parte de la versión 1 (obsoleta).
    await harness.sync.captureAttendance({
      classSessionId: id,
      entries: [{ studentId: 'legajo-1', status: 'justificada' }],
      baseVersion: '1',
      idempotencyKey: 'lww-att',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toMatchObject({ previousVersion: '2', actor: 'dev-user' });
    const entries = await harness.db.query<{ status: string }>(
      'SELECT status FROM attendance_entry WHERE class_session_id = $1',
      [id],
    );
    expect(entries.rows[0]?.status).toBe('justificada');
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('replay idempotente: reintentar la misma operación no duplica el tema', async () => {
    await harness.sync.captureTopic({
      courseId: 'curso-3-1',
      order: 3,
      content: 'Tema',
      idempotencyKey: 'replay-1',
    });
    await harness.client.flush();
    expect(await count(harness, 'topic')).toBe(1);

    const replay = await harness.app.inject({
      method: 'POST',
      url: '/courses/curso-3-1/topics',
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'replay-1' },
      payload: { order: 3, content: 'Tema' },
    });

    expect(replay.statusCode).toBe(201);
    expect(await count(harness, 'topic')).toBe(1);
  });
});
