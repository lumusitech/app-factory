import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

const PAYLOAD = { courseId: 'curso-3-1', date: '2026-10-29' };

/**
 * Aceptación del corte delgado (`docs/teacher-service-context.md` §7, fase 5):
 * crear entidad → trabajar offline → sincronizar → converger → reintentar sin
 * duplicar. Si esto no converge, el kernel no está hecho (fase 3).
 */
describe('convergencia de teacher-service (§7)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('crear → offline → sincronizar → converger → reintentar sin duplicar', async () => {
    // 1. Offline: se captura la creación y el intento de sincronizar corta.
    harness.transport.online = false;
    await harness.sync.captureCreate({ ...PAYLOAD, idempotencyKey: 'op-create-1' });

    const offlineFlush = await harness.client.flush();
    expect(offlineFlush.cut).toBe(true);
    expect(offlineFlush.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await harness.countSessions()).toBe(0);

    // 2. Reconecta y sincroniza: el item se aplica y sale de la cola.
    harness.transport.online = true;
    const onlineFlush = await harness.client.flush();
    expect(onlineFlush.cut).toBe(false);
    expect(onlineFlush.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 201 });
    expect(await harness.client.list()).toHaveLength(0);

    // 3. Converge: la clase quedó persistida en su tenant y con su evento.
    expect(await harness.countSessions()).toBe(1);
    expect(await harness.countOutbox()).toBe(1);
    const { rows } = await harness.db.query<{ id: string }>('SELECT id FROM class_session');
    const id = rows[0]?.id ?? '';

    const readBack = await harness.app.inject({
      method: 'GET',
      url: `/class-sessions/${id}`,
      headers: { 'x-tenant': TENANT },
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toMatchObject({
      data: { courseId: 'curso-3-1', status: 'dictada', version: 1 },
    });

    // 4. Reintentar sin duplicar: el mismo request es un replay idempotente.
    const replayed = await harness.app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT, 'idempotency-key': 'op-create-1' },
      payload: PAYLOAD,
    });
    expect(replayed.statusCode).toBe(201);
    expect(await harness.countSessions()).toBe(1);
    expect(await harness.countOutbox()).toBe(1);
  });

  it('converge también una transición capturada offline (lectura cacheada)', async () => {
    // Crea online para obtener el id y la versión vigente.
    const created = await harness.app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT },
      payload: PAYLOAD,
    });
    const id = created.json<{ data: { id: string; version: number } }>().data.id;

    // Captura la transición offline y sincroniza.
    harness.transport.online = false;
    await harness.sync.captureTransition({
      id,
      status: 'cancelada',
      cancellationReason: 'paro',
      baseVersion: '1',
      idempotencyKey: 'op-cancel-1',
    });
    expect((await harness.client.flush()).outcomes[0]).toMatchObject({ result: 'retained' });

    harness.transport.online = true;
    const flush = await harness.client.flush();
    expect(flush.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(await harness.sessionRow(id)).toMatchObject({
      status: 'cancelada',
      cancellation_reason: 'paro',
      version: 2,
    });
  });

  it('caché GET: lee online y sin red sirve desde la caché (body desenvuelto)', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/class-sessions',
      headers: { 'x-tenant': TENANT },
      payload: PAYLOAD,
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    const online = await harness.client.get<{ id: string; status: string }>(
      `/class-sessions/${id}`,
      `/class-sessions/${id}`,
    );
    expect(online).toMatchObject({ id, status: 'dictada' });

    harness.transport.online = false;
    const cached = await harness.client.get<{ id: string; status: string }>(
      `/class-sessions/${id}`,
      `/class-sessions/${id}`,
    );
    expect(cached).toMatchObject({ id, status: 'dictada' });
  });

  it('probe: no encola ni modifica la cola (sync §6)', async () => {
    expect(await harness.client.probe()).toBe(true);

    harness.transport.online = false;
    expect(await harness.client.probe()).toBe(false);

    expect(await harness.client.list()).toHaveLength(0);
  });
});
