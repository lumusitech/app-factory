import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

/** El ritual de §1.3: 30 notas cargadas como un acto (un item de cola). */
const THIRTY_GRADES = Array.from({ length: 30 }, (_unused, index) => ({
  studentId: `legajo-${String(index + 1).padStart(2, '0')}`,
  value: (index % 10) + 1,
}));

async function createEvaluation(harness: TeacherSyncHarness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/courses/curso-3-1/evaluations',
    headers: { 'x-tenant': TENANT },
    payload: { name: 'Parcial 1', period: 'C1', weight: 1 },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

/**
 * Captura offline de F-02 (calificaciones numéricas) sobre la cola del kernel
 * (`docs/teacher-service-context.md` §8, T10; `docs/contracts/sync.md`).
 */
describe('captura offline de F-02 (calificaciones numéricas)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('la fachada traduce a items de la cola (método, ruta, baseVersion)', async () => {
    const item = await harness.sync.captureGrades({
      evaluationId: 'eval-1',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      baseVersion: '3',
      idempotencyKey: 'k1',
    });

    expect(item).toMatchObject({
      method: 'PUT',
      path: '/evaluations/eval-1/grades',
      baseVersion: '3',
      idempotencyKey: 'k1',
    });
  });

  it('converge: evaluación + 30 notas capturadas offline (un item por evaluación)', async () => {
    // 1. Offline: se crea la evaluación y se cargan las 30 notas; el primer item corta.
    harness.transport.online = false;
    await harness.sync.captureEvaluation({
      courseId: 'curso-3-1',
      name: 'Parcial 1',
      period: 'C1',
      weight: 2,
      id: 'eval-cli-1',
      idempotencyKey: 'e-1',
    });
    await harness.sync.captureGrades({
      evaluationId: 'eval-cli-1',
      entries: THIRTY_GRADES,
      idempotencyKey: 'g-1',
    });

    const offline = await harness.client.flush();
    expect(offline.cut).toBe(true);
    expect(offline.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await harness.countEvaluations()).toBe(0);
    expect(await harness.countGrades()).toBe(0);

    // 2. Reconecta: FIFO aplica los dos items y la cola queda vacía.
    harness.transport.online = true;
    const online = await harness.client.flush();
    expect(online.cut).toBe(false);
    expect(online.outcomes.map((outcome) => outcome.result)).toEqual(['removed', 'removed']);
    expect(await harness.client.list()).toHaveLength(0);

    // 3. Converge: la evaluación y las 30 notas quedaron persistidas en su tenant.
    expect(await harness.countEvaluations()).toBe(1);
    expect(await harness.countGrades()).toBe(30);
    expect(await harness.countOutbox()).toBe(2);

    const readBack = await harness.app.inject({
      method: 'GET',
      url: '/evaluations/eval-cli-1/grades',
      headers: { 'x-tenant': TENANT },
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json<{ data: { entries: unknown[]; version: number } }>().data).toMatchObject({
      version: 1,
    });
    expect(readBack.json<{ data: { entries: unknown[] } }>().data.entries).toHaveLength(30);
  });

  it('borde: valor 1 y valor 10 son válidos (límites de la escala T16)', async () => {
    const id = await createEvaluation(harness);

    await harness.sync.captureGrades({
      evaluationId: id,
      entries: [
        { studentId: 'legajo-1', value: 1 },
        { studentId: 'legajo-2', value: 10 },
      ],
      idempotencyKey: 'lim-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(await harness.countGrades()).toBe(2);
  });

  it('400 (fuera de rango): el item queda `blocked`, visible, y NO se descarta', async () => {
    await harness.sync.captureGrades({
      evaluationId: 'eval-1',
      entries: [{ studentId: 'legajo-1', value: 0 }],
      idempotencyKey: 'rango-0',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    const items = await harness.client.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { statusCode: 400, error: 'VALIDATION_ERROR' },
    });
    expect(await harness.countGrades()).toBe(0);
  });

  it('400 (alumno duplicado): el item queda `blocked`', async () => {
    await harness.sync.captureGrades({
      evaluationId: 'eval-1',
      entries: [
        { studentId: 'legajo-1', value: 7 },
        { studentId: 'legajo-1', value: 8 },
      ],
      idempotencyKey: 'dup-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('404 (evaluación inexistente): el item queda `blocked`', async () => {
    await harness.sync.captureGrades({
      evaluationId: 'no-existe',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'nf-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 404 });
  });

  it('401 (sesión inválida): las notas quedan `blocked`', async () => {
    await harness.sync.captureGrades({
      evaluationId: 'expired-session',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'auth-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('5xx: el item se conserva y el flush corta (no envía el siguiente)', async () => {
    await harness.sync.captureGrades({
      evaluationId: 'boom',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'boom-1',
    });
    await harness.sync.captureEvaluation({
      courseId: 'curso-3-1',
      name: 'Recuperatorio',
      period: 'C1',
      weight: 1,
      idempotencyKey: 'boom-2',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect((await harness.client.list())[0]?.state).toBe('pending');
    expect(await harness.countEvaluations()).toBe(0);
  });

  it('conflicto `lww` en las notas: la última escritura gana con aviso', async () => {
    const id = await createEvaluation(harness);

    // El servidor avanza la hoja a la versión 2.
    await harness.app.inject({
      method: 'PUT',
      url: `/evaluations/${id}/grades`,
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    });
    await harness.app.inject({
      method: 'PUT',
      url: `/evaluations/${id}/grades`,
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 8 }] },
    });

    // Captura offline que parte de la versión 1 (obsoleta).
    await harness.sync.captureGrades({
      evaluationId: id,
      entries: [{ studentId: 'legajo-1', value: 9 }],
      baseVersion: '1',
      idempotencyKey: 'lww-g',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toMatchObject({ previousVersion: '2', actor: 'dev-user' });
    const entries = await harness.db.query<{ value: number }>(
      'SELECT value FROM grade_entry WHERE evaluation_id = $1',
      [id],
    );
    expect(entries.rows[0]?.value).toBe(9);
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('head-of-line: un `blocked` en la cabeza detiene el flush automático', async () => {
    await harness.sync.captureGrades({
      evaluationId: 'eval-1',
      entries: [{ studentId: 'legajo-1', value: 0 }],
      idempotencyKey: 'hl-1',
    });
    await harness.sync.captureEvaluation({
      courseId: 'curso-3-1',
      name: 'Parcial 1',
      period: 'C1',
      weight: 1,
      idempotencyKey: 'hl-2',
    });

    await harness.client.flush(); // el primero queda `blocked`
    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toEqual([expect.objectContaining({ result: 'not-attempted' })]);
    expect(await harness.countEvaluations()).toBe(0);
    const items = await harness.client.list();
    expect(items.map((item) => item.state)).toEqual(['blocked', 'pending']);
  });

  it('replay idempotente: reintentar la misma carga de notas no duplica', async () => {
    const id = await createEvaluation(harness);
    const entry = [{ studentId: 'legajo-1', value: 7 }];

    await harness.sync.captureGrades({ evaluationId: id, entries: entry, idempotencyKey: 'replay-1' });
    await harness.client.flush();
    expect(await harness.countGrades()).toBe(1);

    const replay = await harness.app.inject({
      method: 'PUT',
      url: `/evaluations/${id}/grades`,
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'replay-1' },
      payload: { entries: entry },
    });

    expect(replay.statusCode).toBe(200);
    expect(await harness.countGrades()).toBe(1);
  });
});
