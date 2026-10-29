import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

/** Cede el control para que el flush registre su watchdog antes de vencerlo. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const PAYLOAD = { courseId: 'curso-3-1', date: '2026-10-29' };

/** Tabla de conformidad de `docs/contracts/sync.md` §10, sobre la vertical. */
describe('transiciones de la cola en teacher-service (sync §4/§5)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('2xx: el item se borra de la cola y la clase converge', async () => {
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'ok-1' });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 201 });
    expect(await harness.client.list()).toHaveLength(0);
    expect(await harness.countSessions()).toBe(1);
  });

  it('400 (validación): el item queda `blocked`, visible, y NO se descarta', async () => {
    await harness.sync.captureCreate({
      courseId: 'curso-3-1',
      date: '2026-02-30',
      idempotencyKey: 'bad-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 400 });
    const items = await harness.client.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { statusCode: 400, error: 'VALIDATION_ERROR' },
    });
    expect(await harness.countSessions()).toBe(0);
  });

  it('401: el item queda `blocked` (sesión inválida)', async () => {
    await harness.sync.captureTransition({
      id: 'expired-session',
      status: 'feriado',
      idempotencyKey: 's-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('5xx: el item se conserva y el flush corta (no envía el siguiente)', async () => {
    await harness.sync.captureTransition({
      id: 'boom',
      status: 'feriado',
      idempotencyKey: 'b-1',
    });
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'b-2' });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect(await harness.countSessions()).toBe(0);
    expect((await harness.client.list())[0]?.state).toBe('pending');
  });

  it('head-of-line: un `blocked` en la cabeza detiene el flush automático', async () => {
    await harness.sync.captureCreate({ courseId: '', date: '2026-10-29', idempotencyKey: 'hl-1' });
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'hl-2' });

    await harness.client.flush(); // el primero queda `blocked`
    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toEqual([expect.objectContaining({ result: 'not-attempted' })]);
    expect(await harness.countSessions()).toBe(0);
    const items = await harness.client.list();
    expect(items.map((item) => item.state)).toEqual(['blocked', 'pending']);
  });

  it('error de red: el item se conserva y el flush corta', async () => {
    harness.transport.online = false;
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'net-1' });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
  });

  it('watchdog (20 s): aborta el intento, conserva el item y corta', async () => {
    harness.transport.hang = true;
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'wd-1' });

    const flushing = harness.client.flush();
    await settle();
    expect(harness.scheduler.pendingCount).toBe(1);
    harness.scheduler.fireAll();

    const report = await flushing;
    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'watchdog' });
    expect((await harness.client.list())[0]).toMatchObject({ state: 'pending', attempts: 1 });
  });

  it('FIFO: envía en orden estricto por `order`', async () => {
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'f-1' });
    await harness.sync.captureCreate({ ...PAYLOAD, date: '2026-10-30', idempotencyKey: 'f-2' });

    const report = await harness.client.flush();

    expect(report.attempted).toBe(2);
    expect(report.outcomes.map((outcome) => outcome.order)).toEqual([0, 1]);
    expect(await harness.countSessions()).toBe(2);
  });
});
