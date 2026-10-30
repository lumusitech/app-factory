import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

/**
 * Captura offline del registro del alumno (F-05; ADR 0015) sobre la cola del
 * kernel (`docs/teacher-service-context.md` §8, T10; `docs/contracts/sync.md`).
 */
describe('captura offline de F-05 (registro del alumno)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('la fachada traduce a un item de la cola (método, ruta, body)', async () => {
    const item = await harness.sync.captureStudentRecord({
      studentId: 'legajo-1',
      kind: 'evaluacion',
      occurredOn: '2026-10-30',
      evaluationId: 'e1',
      note: 'Reentrega.',
      grade: 8,
      idempotencyKey: 'sr-1',
    });

    expect(item).toMatchObject({
      method: 'POST',
      path: '/students/legajo-1/records',
      idempotencyKey: 'sr-1',
      body: { kind: 'evaluacion', occurredOn: '2026-10-30', evaluationId: 'e1', grade: 8 },
    });
  });

  it('converge: se captura offline y se persiste al reconectar', async () => {
    harness.transport.online = false;
    await harness.sync.captureStudentRecord({
      studentId: 'legajo-1',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'Participa activamente.',
      idempotencyKey: 'obs-1',
    });

    const offline = await harness.client.flush();
    expect(offline.cut).toBe(true);
    expect(offline.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await harness.countStudentRecords()).toBe(0);

    harness.transport.online = true;
    const online = await harness.client.flush();
    expect(online.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 201 });
    expect(await harness.client.list()).toHaveLength(0);
    expect(await harness.countStudentRecords()).toBe(1);
    expect(await harness.countOutbox()).toBe(1);
  });

  it('400 (observación sin nota): el item queda `blocked`, visible, y NO se descarta', async () => {
    await harness.sync.captureStudentRecord({
      studentId: 'legajo-1',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      idempotencyKey: 'blocked-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    expect((await harness.client.list())[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { statusCode: 400, error: 'VALIDATION_ERROR' },
    });
    expect(await harness.countStudentRecords()).toBe(0);
  });

  it('401 (sesión inválida): el registro queda `blocked`', async () => {
    await harness.sync.captureStudentRecord({
      studentId: 'expired-session',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'x',
      idempotencyKey: 'auth-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
  });

  it('5xx: el item se conserva y el flush corta', async () => {
    await harness.sync.captureStudentRecord({
      studentId: 'boom',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'x',
      idempotencyKey: 'boom-1',
    });
    await harness.sync.captureStudentRecord({
      studentId: 'legajo-1',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'y',
      idempotencyKey: 'boom-2',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect((await harness.client.list())[0]?.state).toBe('pending');
  });

  it('replay idempotente: reintentar el mismo registro no duplica', async () => {
    const capture = {
      studentId: 'legajo-1',
      kind: 'observacion' as const,
      occurredOn: '2026-10-30',
      note: 'Una vez.',
      idempotencyKey: 'replay-1',
    };

    await harness.sync.captureStudentRecord(capture);
    await harness.client.flush();
    expect(await harness.countStudentRecords()).toBe(1);

    const replay = await harness.app.inject({
      method: 'POST',
      url: '/students/legajo-1/records',
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'replay-1' },
      payload: { kind: 'observacion', occurredOn: '2026-10-30', note: 'Una vez.' },
    });

    expect(replay.statusCode).toBe(201);
    expect(await harness.countStudentRecords()).toBe(1);
  });
});
