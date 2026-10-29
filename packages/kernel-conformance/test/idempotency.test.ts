import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from './support/harness.js';
import type { ConformanceHarness } from './support/harness.js';

describe('idempotencia, extremo a extremo (idempotency.md §11)', () => {
  let harness: ConformanceHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('replay: misma key y payload devuelve la misma respuesta sin re-ejecutar', async () => {
    const headers = { 'x-tenant': 'tenant-a', 'idempotency-key': 'idem-1' };
    const payload = { title: 'Una sola' };

    const first = await harness.app.inject({ method: 'POST', url: '/notes', headers, payload });
    const second = await harness.app.inject({ method: 'POST', url: '/notes', headers, payload });

    expect(first.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await harness.countNotes()).toBe(1);
    expect(await harness.countOutbox()).toBe(1);
  });

  it('misma key con payload distinto: 409, no devuelve la respuesta ajena', async () => {
    const headers = { 'x-tenant': 'tenant-a', 'idempotency-key': 'idem-2' };

    await harness.app.inject({ method: 'POST', url: '/notes', headers, payload: { title: 'Original' } });
    const clash = await harness.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: { title: 'Distinta' },
    });

    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
    expect(await harness.countNotes()).toBe(1);
  });

  it('el replay de la cola (mismo Idempotency-Key) no duplica el efecto', async () => {
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'De la cola' },
      idempotencyKey: 'idem-queue',
    });
    await harness.client.flush();

    // El mismo item se reenvía (p. ej. tras reconectar): replay idempotente.
    const replay = await harness.app.inject({
      method: 'POST',
      url: '/notes',
      headers: {
        'x-tenant': 'tenant-a',
        'idempotency-key': 'idem-queue',
        'x-offline-replay': 'true',
      },
      payload: { title: 'De la cola' },
    });

    expect(replay.statusCode).toBe(201);
    expect(await harness.countNotes()).toBe(1);
  });

  it('X-Connectivity-Probe: no toca el store de idempotencia', async () => {
    const probe = await harness.app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-connectivity-probe': 'true' },
    });

    expect(probe.statusCode).toBe(200);
    expect(await harness.countNotes()).toBe(0);
  });
});
