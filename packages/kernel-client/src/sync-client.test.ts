import { describe, expect, it } from 'vitest';

import { QueuePreconditionError } from './errors.js';
import type { TransportResult } from './ports/transport.js';
import {
  StubTransport,
  envelope,
  errorEnvelope,
  makeHarness,
  networkError,
  response,
  settle,
} from '../test/support/fakes.js';

describe('enqueue — precondición de encolado (sync §1)', () => {
  it('rechaza una lectura (solo las mutaciones se encolan)', async () => {
    const { client } = makeHarness();
    await expect(
      client.enqueue({ method: 'GET' as never, path: '/notes', idempotencyKey: 'k1' }),
    ).rejects.toBeInstanceOf(QueuePreconditionError);
  });

  it('rechaza una mutación sin Idempotency-Key', async () => {
    const { client } = makeHarness();
    await expect(
      client.enqueue({ method: 'POST', path: '/notes', idempotencyKey: '   ' }),
    ).rejects.toBeInstanceOf(QueuePreconditionError);
  });

  it('rechaza una ruta declarada no encolable por la política (§1.2)', async () => {
    const { client } = makeHarness({ policy: { isQueueable: () => false } });
    await expect(
      client.enqueue({ method: 'POST', path: '/sessions', idempotencyKey: 'k1' }),
    ).rejects.toBeInstanceOf(QueuePreconditionError);
  });

  it('asigna `order` FIFO creciente y los campos normativos', async () => {
    const { client } = makeHarness();

    const first = await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    const second = await client.enqueue({ method: 'PATCH', path: '/b', idempotencyKey: 'k2' });

    expect(first).toMatchObject({
      id: 'id-1',
      order: 0,
      method: 'POST',
      path: '/a',
      body: null,
      idempotencyKey: 'k1',
      baseVersion: null,
      state: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      blockedReason: null,
    });
    expect(second.order).toBe(1);
  });
});

describe('flush — transiciones (sync §4)', () => {
  it('2xx: borra el item y continúa con el siguiente', async () => {
    const { client, transport } = makeHarness();
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    await client.enqueue({ method: 'POST', path: '/b', idempotencyKey: 'k2' });

    const report = await client.flush();

    expect(report.cut).toBe(false);
    expect(report.attempted).toBe(2);
    expect(report.outcomes.map((outcome) => outcome.result)).toEqual(['removed', 'removed']);
    expect(transport.requests).toHaveLength(2);
    expect(await client.list()).toHaveLength(0);
  });

  it('401: marca `blocked` visible y NO envía los posteriores (head-of-line, §5.1)', async () => {
    const transport = new StubTransport((_request, call) =>
      call === 1
        ? response(401, errorEnvelope(401, 'Sesión inválida', 'UNAUTHORIZED'))
        : response(200, envelope({ ok: true })),
    );
    const { client } = makeHarness({ transport });
    const first = await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    await client.enqueue({ method: 'POST', path: '/b', idempotencyKey: 'k2' });

    const report = await client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]).toMatchObject({ id: first.id, result: 'blocked', statusCode: 401 });
    expect(transport.requests).toHaveLength(1);

    const items = await client.list();
    expect(items[0]).toMatchObject({ state: 'blocked', blockedReason: { statusCode: 401 } });
    expect(items[1]).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('4xx (no 401): marca `blocked` y conserva el motivo del envelope', async () => {
    const transport = new StubTransport(() =>
      response(422, errorEnvelope(422, 'Payload inválido', 'VALIDATION_ERROR')),
    );
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });

    await client.flush();

    const [item] = await client.list();
    expect(item).toMatchObject({
      state: 'blocked',
      attempts: 1,
      blockedReason: { statusCode: 422, message: 'Payload inválido', error: 'VALIDATION_ERROR' },
    });
  });

  it('5xx: conserva en `pending` y corta el flush', async () => {
    const transport = new StubTransport((_request, call) =>
      call === 1 ? response(503, errorEnvelope(503, 'No disponible', null)) : response(200, envelope({})),
    );
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    await client.enqueue({ method: 'POST', path: '/b', idempotencyKey: 'k2' });

    const report = await client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'http', statusCode: 503 });
    expect(transport.requests).toHaveLength(1);
    const [item] = await client.list();
    expect(item).toMatchObject({ state: 'pending', attempts: 1 });
  });

  it('error de red: conserva y corta', async () => {
    const transport = new StubTransport(() => networkError(new Error('ECONNRESET')));
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });

    const report = await client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect((await client.list())[0]?.state).toBe('pending');
  });

  it('transporte que rechaza (conexión caída a mitad) se trata como error de red', async () => {
    const transport = new StubTransport(() => Promise.reject(new Error('socket roto')));
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });

    const report = await client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
  });

  it('watchdog vencido: aborta el intento, conserva el item y corta (§5.2)', async () => {
    const never: Promise<TransportResult> = new Promise(() => undefined);
    const transport = new StubTransport(() => never);
    const { client, scheduler } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });

    const flushing = client.flush();
    await settle();
    expect(scheduler.pendingCount).toBe(1);
    scheduler.fireAll();

    const report = await flushing;
    expect(report.cut).toBe(true);
    expect(report.outcomes[0]).toMatchObject({ result: 'retained', reason: 'watchdog' });
    const [item] = await client.list();
    expect(item).toMatchObject({ state: 'pending', attempts: 1 });
  });

  it('FIFO: envía en orden estricto por `order`', async () => {
    const transport = new StubTransport(() => response(200, envelope({})));
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    await client.enqueue({ method: 'POST', path: '/b', idempotencyKey: 'k2' });
    await client.enqueue({ method: 'PATCH', path: '/c', idempotencyKey: 'k3' });

    await client.flush();

    expect(transport.requests.map((request) => request.path)).toEqual(['/a', '/b', '/c']);
  });

  it('un item `blocked` preexistente en la cabeza detiene el flush automático', async () => {
    const transport = new StubTransport((_request, call) =>
      call === 1 ? response(401, errorEnvelope(401, 'Sesión inválida', 'UNAUTHORIZED')) : response(200, envelope({})),
    );
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    await client.enqueue({ method: 'POST', path: '/b', idempotencyKey: 'k2' });

    await client.flush(); // bloquea el primero
    transport.requests.length = 0;

    const report = await client.flush();

    expect(report.cut).toBe(true);
    expect(report.outcomes).toEqual([
      expect.objectContaining({ result: 'not-attempted' }),
    ]);
    expect(transport.requests).toHaveLength(0);
  });
});

describe('conflicto de versión (sync §8)', () => {
  it('envía `baseVersion` como X-Sync-Base-Version y `X-Offline-Replay`', async () => {
    const transport = new StubTransport(() => response(200, envelope({})));
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'PATCH', path: '/a', idempotencyKey: 'k1', baseVersion: 'v3' });

    await client.flush();

    expect(transport.requests[0]?.headers).toMatchObject({
      'Idempotency-Key': 'k1',
      'X-Offline-Replay': 'true',
      'X-Sync-Base-Version': 'v3',
    });
  });

  it('no envía X-Sync-Base-Version si el item no versiona', async () => {
    const transport = new StubTransport(() => response(201, envelope({})));
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });

    await client.flush();

    expect(transport.requests[0]?.headers).not.toHaveProperty('X-Sync-Base-Version');
  });

  it('409 `blocked`: el item no se aplica y queda visible', async () => {
    const transport = new StubTransport(() =>
      response(409, errorEnvelope(409, 'Escritura obsoleta', 'SYNC_VERSION_CONFLICT')),
    );
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'PATCH', path: '/a', idempotencyKey: 'k1', baseVersion: 'v1' });

    const report = await client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 409 });
    expect((await client.list())[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { error: 'SYNC_VERSION_CONFLICT' },
    });
  });

  it('lww: aplica, borra el item y expone la señal de sobrescritura', async () => {
    const signal = {
      previousVersion: 'v1',
      actor: 'user-9',
      deviceLabel: 'Android · Pixel 8',
      at: '2026-10-29T12:00:00.000Z',
    };
    const transport = new StubTransport(() =>
      response(200, {
        statusCode: 200,
        data: { id: 'a' },
        timestamp: '2026-10-29T12:00:00.000Z',
        sync: signal,
      }),
    );
    const { client } = makeHarness({ transport });
    await client.enqueue({ method: 'PATCH', path: '/a', idempotencyKey: 'k1', baseVersion: 'v1' });

    const report = await client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', overwritten: signal });
    expect(await client.list()).toHaveLength(0);
  });
});

describe('requeue — intervención humana (sync §3)', () => {
  it('devuelve un item `blocked` a `pending` y limpia el motivo', async () => {
    const transport = new StubTransport(() =>
      response(401, errorEnvelope(401, 'Sesión inválida', 'UNAUTHORIZED')),
    );
    const { client } = makeHarness({ transport });
    const item = await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });
    await client.flush();

    await client.requeue(item.id);

    expect((await client.list())[0]).toMatchObject({ state: 'pending', blockedReason: null });
  });

  it('borde: reencolar un item `pending` o inexistente no hace nada', async () => {
    const { client } = makeHarness();
    const item = await client.enqueue({ method: 'POST', path: '/a', idempotencyKey: 'k1' });

    await client.requeue(item.id);
    await client.requeue('no-existe');

    expect((await client.list())[0]?.state).toBe('pending');
  });
});
