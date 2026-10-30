import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

/** El ritual de §1.3: los 30 overrides del cierre de un curso cargados como un acto. */
const THIRTY = Array.from({ length: 30 }, (_unused, index) => ({
  studentId: `legajo-${String(index + 1).padStart(2, '0')}`,
  value: (index % 10) + 1,
}));

/**
 * Captura offline de F-12 (cierre de período) sobre la cola del kernel
 * (`docs/teacher-service-context.md` §8; `docs/contracts/sync.md`).
 */
describe('captura offline de F-12 (cierre de período)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('la fachada traduce a items de la cola (método, ruta, baseVersion)', async () => {
    const item = await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 7, motive: 'Recuperó' }],
      baseVersion: '3',
      idempotencyKey: 'k1',
    });

    expect(item).toMatchObject({
      method: 'PUT',
      path: '/courses/curso-3-1/period-closings/2026-C1',
      baseVersion: '3',
      idempotencyKey: 'k1',
    });
  });

  it('converge: 30 overrides capturados offline (un item por curso/período)', async () => {
    harness.transport.online = false;
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: THIRTY,
      idempotencyKey: 'c-1',
    });

    const offline = await harness.client.flush();
    expect(offline.cut).toBe(true);
    expect(offline.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await harness.countPeriodClosings()).toBe(0);
    expect(await harness.countPeriodClosingEntries()).toBe(0);

    harness.transport.online = true;
    const online = await harness.client.flush();
    expect(online.cut).toBe(false);
    expect(online.outcomes.map((outcome) => outcome.result)).toEqual(['removed']);
    expect(await harness.client.list()).toHaveLength(0);

    expect(await harness.countPeriodClosings()).toBe(1);
    expect(await harness.countPeriodClosingEntries()).toBe(30);
    expect(await harness.countOutbox()).toBe(1);

    const readBack = await harness.app.inject({
      method: 'GET',
      url: '/courses/curso-3-1/period-closings/2026-C1',
      headers: { 'x-tenant': TENANT },
    });
    expect(readBack.statusCode).toBe(200);
    // La vista derivada incluye los 30 alumnos (con override manual).
    expect(
      readBack.json<{ data: { students: unknown[] } }>().data.students,
    ).toHaveLength(30);
  });

  it('borde: 400 (valor fuera de rango) → el item queda `blocked`, visible, y no se descarta', async () => {
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 11 }],
      idempotencyKey: 'range-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    const items = await harness.client.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { statusCode: 400, error: 'VALIDATION_ERROR' },
    });
    expect(await harness.countPeriodClosingEntries()).toBe(0);
  });

  it('borde: 400 (alumno duplicado) → el item queda `blocked`', async () => {
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
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

  it('401 (sesión inválida): el cierre queda `blocked`', async () => {
    await harness.sync.capturePeriodClosing({
      courseId: 'expired-session',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'auth-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('5xx: el item se conserva y el flush corta (no envía el siguiente)', async () => {
    await harness.sync.capturePeriodClosing({
      courseId: 'boom',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'boom-1',
    });
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'boom-2',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect((await harness.client.list())[0]?.state).toBe('pending');
    expect(await harness.countPeriodClosings()).toBe(0);
  });

  it('conflicto `lww` en el cierre: la última escritura gana con aviso', async () => {
    // El servidor avanza la hoja a la versión 2.
    await harness.app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/period-closings/2026-C1',
      headers: { 'x-tenant': TENANT },
      payload: { entries: [{ studentId: 'legajo-1', value: 7 }] },
    });
    await harness.app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/period-closings/2026-C1',
      headers: { 'x-tenant': TENANT, 'x-sync-base-version': '1' },
      payload: { entries: [{ studentId: 'legajo-1', value: 8 }] },
    });

    // Captura offline que parte de la versión 1 (obsoleta).
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 10 }],
      baseVersion: '1',
      idempotencyKey: 'lww-c',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toMatchObject({ previousVersion: '2', actor: 'dev-user' });
    const entries = await harness.db.query<{ value: number }>(
      'SELECT value FROM period_closing_entry WHERE course_id = $1',
      ['curso-3-1'],
    );
    expect(entries.rows[0]?.value).toBe(10);
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('head-of-line: un `blocked` en la cabeza detiene el flush automático', async () => {
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 99 }],
      idempotencyKey: 'hl-1',
    });
    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries: [{ studentId: 'legajo-1', value: 7 }],
      idempotencyKey: 'hl-2',
    });

    await harness.client.flush(); // el primero queda `blocked`
    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toEqual([expect.objectContaining({ result: 'not-attempted' })]);
    const items = await harness.client.list();
    expect(items.map((item) => item.state)).toEqual(['blocked', 'pending']);
  });

  it('replay idempotente: reintentar el mismo cierre no duplica', async () => {
    const entries = [{ studentId: 'legajo-1', value: 7 }];

    await harness.sync.capturePeriodClosing({
      courseId: 'curso-3-1',
      period: '2026-C1',
      entries,
      idempotencyKey: 'replay-1',
    });
    await harness.client.flush();
    expect(await harness.countPeriodClosingEntries()).toBe(1);

    const replay = await harness.app.inject({
      method: 'PUT',
      url: '/courses/curso-3-1/period-closings/2026-C1',
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'replay-1' },
      payload: { entries },
    });

    expect(replay.statusCode).toBe(200);
    expect(await harness.countPeriodClosingEntries()).toBe(1);
  });
});
