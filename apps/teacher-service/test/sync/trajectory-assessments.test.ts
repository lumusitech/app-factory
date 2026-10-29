import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

/** El ritual de §1.3: las 30 valoraciones de un curso marcadas como un acto. */
const RATINGS = ['TEA', 'TEP', 'TED'] as const;
const THIRTY = Array.from({ length: 30 }, (_unused, index) => ({
  studentId: `legajo-${String(index + 1).padStart(2, '0')}`,
  rating: RATINGS[index % 3] ?? 'TEP',
}));

/**
 * Captura offline de F-03 (valoración preliminar TEA/TEP/TED) sobre la cola del
 * kernel (`docs/teacher-service-context.md` §8; `docs/contracts/sync.md`).
 */
describe('captura offline de F-03 (valoración preliminar TEA/TEP/TED)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('la fachada traduce a items de la cola (método, ruta, baseVersion)', async () => {
    const item = await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'TEA' }],
      baseVersion: '3',
      idempotencyKey: 'k1',
    });

    expect(item).toMatchObject({
      method: 'PUT',
      path: '/courses/curso-3-1/trajectory-assessments/2026-C1',
      baseVersion: '3',
      idempotencyKey: 'k1',
    });
  });

  it('converge: 30 valoraciones capturadas offline (un item por curso/período)', async () => {
    // 1. Offline: se capturan las 30 valoraciones; el intento corta.
    harness.transport.online = false;
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: THIRTY,
      idempotencyKey: 't-1',
    });

    const offline = await harness.client.flush();
    expect(offline.cut).toBe(true);
    expect(offline.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await harness.countTrajectoryAssessments()).toBe(0);
    expect(await harness.countTrajectoryEntries()).toBe(0);

    // 2. Reconecta: FIFO aplica el item y la cola queda vacía.
    harness.transport.online = true;
    const online = await harness.client.flush();
    expect(online.cut).toBe(false);
    expect(online.outcomes.map((outcome) => outcome.result)).toEqual(['removed']);
    expect(await harness.client.list()).toHaveLength(0);

    // 3. Converge: la hoja y las 30 filas quedaron persistidas en su tenant.
    expect(await harness.countTrajectoryAssessments()).toBe(1);
    expect(await harness.countTrajectoryEntries()).toBe(30);
    expect(await harness.countOutbox()).toBe(1);

    const readBack = await harness.app.inject({
      method: 'GET',
      url: '/courses/curso-3-1/trajectory-assessments/2026-C1',
      headers: { 'x-tenant': TENANT },
    });
    expect(readBack.statusCode).toBe(200);
    expect(
      readBack.json<{ data: { entries: unknown[]; version: number } }>().data,
    ).toMatchObject({ version: 1 });
    expect(readBack.json<{ data: { entries: unknown[] } }>().data.entries).toHaveLength(30);
  });

  it('borde: 400 (rating fuera del enum) → el item queda `blocked`, visible, y no se descarta', async () => {
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'Aprobado' as never }],
      idempotencyKey: 'enum-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    const items = await harness.client.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { statusCode: 400, error: 'VALIDATION_ERROR' },
    });
    expect(await harness.countTrajectoryEntries()).toBe(0);
  });

  it('borde: 400 (alumno duplicado) → el item queda `blocked`', async () => {
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [
        { studentId: 'legajo-1', rating: 'TEA' },
        { studentId: 'legajo-1', rating: 'TED' },
      ],
      idempotencyKey: 'dup-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('401 (sesión inválida): la valoración queda `blocked`', async () => {
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'expired-session',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'TEA' }],
      idempotencyKey: 'auth-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('5xx: el item se conserva y el flush corta (no envía el siguiente)', async () => {
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'boom',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'TEA' }],
      idempotencyKey: 'boom-1',
    });
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'TEP' }],
      idempotencyKey: 'boom-2',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect((await harness.client.list())[0]?.state).toBe('pending');
    expect(await harness.countTrajectoryAssessments()).toBe(0);
  });

  it('conflicto `lww` en la valoración: la última escritura gana con aviso', async () => {
    // El servidor avanza la hoja a la versión 2.
    await harness.app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/trajectory-assessments/2026-C1',
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEA' }] },
    });
    await harness.app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/trajectory-assessments/2026-C1',
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', rating: 'TEP' }] },
    });

    // Captura offline que parte de la versión 1 (obsoleta).
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'TED' }],
      baseVersion: '1',
      idempotencyKey: 'lww-t',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toMatchObject({ previousVersion: '2', actor: 'dev-user' });
    const entries = await harness.db.query<{ rating: string }>(
      'SELECT rating FROM trajectory_assessment_entry WHERE course_id = $1',
      ['curso-3-1'],
    );
    expect(entries.rows[0]?.rating).toBe('TED');
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('head-of-line: un `blocked` en la cabeza detiene el flush automático', async () => {
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'Aprobado' as never }],
      idempotencyKey: 'hl-1',
    });
    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', rating: 'TEA' }],
      idempotencyKey: 'hl-2',
    });

    await harness.client.flush(); // el primero queda `blocked`
    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toEqual([expect.objectContaining({ result: 'not-attempted' })]);
    const items = await harness.client.list();
    expect(items.map((item) => item.state)).toEqual(['blocked', 'pending']);
  });

  it('replay idempotente: reintentar la misma valoración no duplica', async () => {
    const entries = [{ studentId: 'legajo-1', rating: 'TEA' as const }];

    await harness.sync.captureTrajectoryAssessment({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries,
      idempotencyKey: 'replay-1',
    });
    await harness.client.flush();
    expect(await harness.countTrajectoryEntries()).toBe(1);

    const replay = await harness.app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/trajectory-assessments/2026-C1',
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'replay-1' },
      payload: { entries },
    });

    expect(replay.statusCode).toBe(200);
    expect(await harness.countTrajectoryEntries()).toBe(1);
  });
});
