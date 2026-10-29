import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from './support/harness.js';
import type { ConformanceHarness } from './support/harness.js';

/** Cede el control para que el flush registre su watchdog antes de vencerlo. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('transiciones de la cola, extremo a extremo (sync §4/§5)', () => {
  let harness: ConformanceHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('2xx: el item se borra de la cola', async () => {
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'Ok' },
      idempotencyKey: 'ok-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 201 });
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('400 (validación): el item queda `blocked`, visible, y NO se descarta', async () => {
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: '' },
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
  });

  it('401: el item queda `blocked` (sesión inválida)', async () => {
    await harness.client.enqueue({
      method: 'POST',
      path: '/session-refresh',
      idempotencyKey: 's-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 401 });
    expect((await harness.client.list())[0]?.state).toBe('blocked');
  });

  it('5xx: el item se conserva y el flush corta (no envía el siguiente)', async () => {
    await harness.client.enqueue({ method: 'POST', path: '/boom', idempotencyKey: 'b-1' });
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'No debería enviarse' },
      idempotencyKey: 'b-2',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', statusCode: 500 });
    expect(await harness.countNotes()).toBe(0);
    expect((await harness.client.list())[0]?.state).toBe('pending');
  });

  it('head-of-line: un `blocked` en la cabeza detiene el flush automático', async () => {
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: '' },
      idempotencyKey: 'hl-1',
    });
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'Válida' },
      idempotencyKey: 'hl-2',
    });

    await harness.client.flush(); // el primero queda `blocked`
    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toEqual([expect.objectContaining({ result: 'not-attempted' })]);
    expect(await harness.countNotes()).toBe(0);
    const items = await harness.client.list();
    expect(items.map((item) => item.state)).toEqual(['blocked', 'pending']);
  });

  it('error de red: el item se conserva y el flush corta', async () => {
    harness.transport.online = false;
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'Sin red' },
      idempotencyKey: 'net-1',
    });

    const report = await harness.client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
  });

  it('watchdog (20 s): aborta el intento, conserva el item y corta', async () => {
    harness.transport.hang = true;
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'Cuelga' },
      idempotencyKey: 'wd-1',
    });

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
    await harness.client.enqueue({ method: 'POST', path: '/notes', body: { title: 'Uno' }, idempotencyKey: 'f-1' });
    await harness.client.enqueue({ method: 'POST', path: '/notes', body: { title: 'Dos' }, idempotencyKey: 'f-2' });

    const report = await harness.client.flush();

    expect(report.attempted).toBe(2);
    expect(report.outcomes.map((outcome) => outcome.order)).toEqual([0, 1]);
    expect(await harness.countNotes()).toBe(2);
  });
});
