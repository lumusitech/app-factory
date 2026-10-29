import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEVICE_LABEL, TENANT, createTeacherSyncHarness } from './support/harness.js';
import type { TeacherSyncHarness } from './support/harness.js';

const PAYLOAD = { courseId: 'curso-3-1', date: '2026-10-29' };

async function createSession(harness: TeacherSyncHarness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/class-sessions',
    headers: { 'x-tenant': TENANT },
    payload: PAYLOAD,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

/** Avanza la versión del servidor con un PATCH directo (sin pasar por la cola). */
async function advance(harness: TeacherSyncHarness, id: string, baseVersion: string): Promise<void> {
  const response = await harness.app.inject({
    method: 'PATCH',
    url: `/class-sessions/${id}`,
    headers: { 'x-tenant': TENANT, 'x-sync-base-version': baseVersion },
    payload: { status: 'feriado' },
  });
  expect(response.statusCode).toBe(200);
}

/**
 * Política de conflicto `lww` de teacher-service (T10, ADR 0010; sync §8): la
 * última escritura gana y **nunca es silenciosa** — devuelve la señal.
 */
describe('conflicto `lww` en teacher-service (sync §8)', () => {
  let harness: TeacherSyncHarness;

  beforeEach(async () => {
    harness = await createTeacherSyncHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('`lww`: la escritura obsoleta se aplica, borra el item y devuelve la señal', async () => {
    const id = await createSession(harness);
    await advance(harness, id, '1'); // el servidor pasa a la versión 2

    await harness.sync.captureTransition({
      id,
      status: 'cancelada',
      cancellationReason: 'paro',
      baseVersion: '1',
      idempotencyKey: 'lww-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toMatchObject({
      previousVersion: '2',
      actor: 'dev-user',
      deviceLabel: DEVICE_LABEL,
    });
    expect(await harness.sessionRow(id)).toMatchObject({
      status: 'cancelada',
      cancellation_reason: 'paro',
      version: 3,
    });
    expect(await harness.client.list()).toHaveLength(0);
  });

  it('`baseVersion` coincidente: sin conflicto, se aplica sin señal', async () => {
    const id = await createSession(harness);

    await harness.sync.captureTransition({
      id,
      status: 'feriado',
      baseVersion: '1',
      idempotencyKey: 'ok-1',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed', statusCode: 200 });
    expect(report.outcomes[0]?.overwritten).toBeUndefined();
    expect(await harness.sessionRow(id)).toMatchObject({ status: 'feriado', version: 2 });
  });

  it('sin `baseVersion`: la operación no versiona y se aplica', async () => {
    const id = await createSession(harness);

    await harness.sync.captureTransition({
      id,
      status: 'sin_clase',
      idempotencyKey: 'no-version',
    });

    const report = await harness.client.flush();

    expect(report.outcomes[0]).toMatchObject({ result: 'removed' });
    expect(await harness.sessionRow(id)).toMatchObject({ status: 'sin_clase', version: 2 });
  });
});
