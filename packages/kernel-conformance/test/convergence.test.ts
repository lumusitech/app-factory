import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from './support/harness.js';
import type { ConformanceHarness } from './support/harness.js';

/**
 * El **test de aceptación del kernel** (`docs/kernel-context.md` §7, fase 3):
 * crear entidad → trabajar offline → sincronizar → converger → reintentar sin
 * duplicar. Un kernel no está "hecho" hasta que esto pasa.
 */
describe('suite de convergencia (§7)', () => {
  let harness: ConformanceHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('crear → offline → sincronizar → converger → reintentar sin duplicar', async () => {
    // 1. Offline: se captura la creación y se intenta sincronizar sin conexión.
    harness.transport.online = false;
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'Nota offline' },
      idempotencyKey: 'op-create-1',
    });

    const offlineFlush = await harness.client.flush();
    expect(offlineFlush.cut).toBe(true);
    expect(offlineFlush.outcomes[0]).toMatchObject({ result: 'retained', reason: 'network' });
    expect(await harness.countNotes()).toBe(0);

    // 2. Reconecta y sincroniza: el item se aplica y sale de la cola.
    harness.transport.online = true;
    const onlineFlush = await harness.client.flush();
    expect(onlineFlush.cut).toBe(false);
    expect(onlineFlush.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 201 });
    expect(await harness.client.list()).toHaveLength(0);

    // 3. Converge: el servidor tiene la entidad, en el tenant correcto, con su evento.
    expect(await harness.countNotes()).toBe(1);
    expect(await harness.countOutbox()).toBe(1);
    const { rows } = await harness.executor.query<{ id: string; tenant_id: string; title: string }>(
      'SELECT id, tenant_id, title FROM conformance_note',
    );
    const row = rows[0];
    expect(row).toMatchObject({ tenant_id: 'tenant-a', title: 'Nota offline' });

    const readBack = await harness.app.inject({
      method: 'GET',
      url: `/notes/${row?.id ?? ''}`,
      headers: { 'x-tenant': 'tenant-a' },
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toMatchObject({ data: { title: 'Nota offline' } });

    // 4. Reintentar sin duplicar: el mismo request es un replay idempotente.
    const replayed = await harness.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a', 'idempotency-key': 'op-create-1' },
      payload: { title: 'Nota offline' },
    });
    expect(replayed.statusCode).toBe(201);
    expect(await harness.countNotes()).toBe(1);
    expect(await harness.countOutbox()).toBe(1);
  });

  it('caché GET: lee online, y sin red sirve desde la caché (body desenvuelto)', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: 'Cacheable' },
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    const online = await harness.client.get<{ id: string; title: string }>(
      `/notes/${id}`,
      `/notes/${id}`,
    );
    expect(online).toMatchObject({ id, title: 'Cacheable' });

    harness.transport.online = false;
    const cached = await harness.client.get<{ id: string; title: string }>(
      `/notes/${id}`,
      `/notes/${id}`,
    );
    expect(cached).toMatchObject({ id, title: 'Cacheable' });
  });

  it('probe: no encola ni modifica la cola (sync §6)', async () => {
    expect(await harness.client.probe()).toBe(true);

    harness.transport.online = false;
    expect(await harness.client.probe()).toBe(false);

    expect(await harness.client.list()).toHaveLength(0);
  });
});
