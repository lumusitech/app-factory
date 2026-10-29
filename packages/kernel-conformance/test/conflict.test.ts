import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from './support/harness.js';
import type { ConformanceHarness } from './support/harness.js';

async function createNote(harness: ConformanceHarness, title: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/notes',
    headers: { 'x-tenant': 'tenant-a' },
    payload: { title },
  });
  return response.json<{ data: { id: string } }>().data.id;
}

/** Avanza la versión del servidor con un PATCH directo (sin pasar por la cola). */
async function advance(harness: ConformanceHarness, path: string, id: string, title: string, baseVersion: string): Promise<void> {
  const response = await harness.app.inject({
    method: 'PATCH',
    url: `${path}/${id}`,
    headers: { 'x-tenant': 'tenant-a', 'x-sync-base-version': baseVersion },
    payload: { title },
  });
  expect(response.statusCode).toBe(200);
}

describe('política de conflicto, extremo a extremo (sync §8)', () => {
  let harness: ConformanceHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('`blocked` (default): 409, la escritura no se aplica y el item queda visible', async () => {
    const id = await createNote(harness, 'V1');
    await advance(harness, '/locked-notes', id, 'V2', '1');

    await harness.client.enqueue({
      method: 'PATCH',
      path: `/locked-notes/${id}`,
      body: { title: 'Offline viejo' },
      idempotencyKey: 'cf-blocked',
      baseVersion: '1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'blocked', statusCode: 409 });
    expect(await harness.noteRow(id)).toMatchObject({ title: 'V2', version: 2 });
    expect((await harness.client.list())[0]).toMatchObject({
      state: 'blocked',
      blockedReason: { error: 'SYNC_VERSION_CONFLICT' },
    });
  });

  it('`lww` (opt-in): aplica la última escritura, borra el item y devuelve la señal', async () => {
    const id = await createNote(harness, 'V1');
    await advance(harness, '/notes', id, 'V2', '1');

    await harness.client.enqueue({
      method: 'PATCH',
      path: `/notes/${id}`,
      body: { title: 'Offline gana' },
      idempotencyKey: 'cf-lww',
      baseVersion: '1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toMatchObject({
      previousVersion: '2',
      actor: 'user-1',
      deviceLabel: 'conformance · inject',
    });
    expect(await harness.noteRow(id)).toMatchObject({ title: 'Offline gana', version: 3 });
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('`baseVersion` coincidente: sin conflicto, se aplica sin señal', async () => {
    const id = await createNote(harness, 'V1');

    await harness.client.enqueue({
      method: 'PATCH',
      path: `/notes/${id}`,
      body: { title: 'V2' },
      idempotencyKey: 'cf-ok',
      baseVersion: '1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toBeUndefined();
    expect(await harness.noteRow(id)).toMatchObject({ title: 'V2', version: 2 });
  });

  it('sin `baseVersion`: la operación no versiona y se aplica', async () => {
    const id = await createNote(harness, 'V1');

    await harness.client.enqueue({
      method: 'PATCH',
      path: `/notes/${id}`,
      body: { title: 'Renombrada' },
      idempotencyKey: 'cf-noversion',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed' });
    expect(await harness.noteRow(id)).toMatchObject({ title: 'Renombrada' });
  });

  it('reencolar tras resolver: el item `blocked` vuelve a `pending` y converge', async () => {
    const id = await createNote(harness, 'V1');
    await advance(harness, '/locked-notes', id, 'V2', '1');

    const item = await harness.client.enqueue({
      method: 'PATCH',
      path: `/locked-notes/${id}`,
      body: { title: 'Corregida' },
      idempotencyKey: 'cf-requeue',
      baseVersion: '1',
    });

    await harness.client.flush();
    // Intervención humana: reencola con el token vigente (resolución explícita).
    await harness.client.requeue(item.id);
    await reloadWithBaseVersion(harness, item.id, '2');
    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(await harness.noteRow(id)).toMatchObject({ title: 'Corregida', version: 3 });
  });
});

/** Reescribe el `baseVersion` de un item `pending` (la corrección del usuario). */
async function reloadWithBaseVersion(
  harness: ConformanceHarness,
  id: string,
  baseVersion: string,
): Promise<void> {
  const items = await harness.queueStore.list();
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new Error(`item ${id} no está en la cola`);
  }
  await harness.queueStore.update({ ...item, baseVersion });
}
