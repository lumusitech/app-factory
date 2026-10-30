import { PGlite } from '@electric-sql/pglite';
import { createPgliteConnection } from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { headerSessionResolver } from '../../src/identity.js';
import { runAppMigrations } from '../../src/migrations.js';

/**
 * Borde del registro del alumno (F-05; ADR 0015): `POST/GET
 * /students/:studentId/records`. Cubre los **tres tipos** de entrada, la
 * validación (fecha, obligatoriedad, límites de nota), la **lista ordenada** por
 * fecha, el **alcance** (cross-tenant y fail-closed) y el replay idempotente.
 */

const TENANT = 'docente-1';

let db: PGlite;
let app: FastifyInstance;

beforeEach(async () => {
  db = new PGlite();
  const connection = createPgliteConnection(db);
  await runAppMigrations(connection);
  app = await buildApp({ connection, clock: { now: () => new Date('2026-10-30T12:00:00.000Z') }, resolver: headerSessionResolver });
});

afterEach(async () => {
  await app.close();
  await db.close();
});

function post(payload: unknown, headers: Record<string, string> = { 'x-tenant': TENANT }) {
  return app.inject({
    method: 'POST',
    url: '/students/legajo-1/records',
    headers,
    payload: payload as Record<string, unknown>,
  });
}

function get(studentId = 'legajo-1', tenant: string | null = TENANT) {
  return app.inject({
    method: 'GET',
    url: `/students/${studentId}/records`,
    headers: tenant === null ? {} : { 'x-tenant': tenant },
  });
}

describe('registro del alumno (F-05, ADR 0015)', () => {
  it('crea una observación (201) con estado automático nulo', async () => {
    const response = await post({
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'Participa activamente.',
      category: 'rendimiento',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: unknown }>().data).toMatchObject({
      studentId: 'legajo-1',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'Participa activamente.',
      category: 'rendimiento',
      evaluationId: null,
      grade: null,
      version: 1,
    });
  });

  it('crea un movimiento (baja/traslado) con su motivo', async () => {
    const response = await post({
      kind: 'movimiento',
      occurredOn: '2026-10-30',
      note: 'Se traslada a otra escuela por mudanza familiar.',
      category: 'traslado',
    });
    expect(response.statusCode).toBe(201);
  });

  it('crea la evolución de una evaluación, con nota opcional', async () => {
    const withGrade = await post({
      kind: 'evaluacion',
      occurredOn: '2026-10-30',
      evaluationId: 'eval-1',
      note: 'Reentrega: corrigió el compás.',
      grade: 8,
    });
    expect(withGrade.statusCode).toBe(201);
    expect(withGrade.json<{ data: unknown }>().data).toMatchObject({ evaluationId: 'eval-1', grade: 8 });

    const withoutGrade = await post({
      kind: 'evaluacion',
      occurredOn: '2026-10-30',
      evaluationId: 'eval-2',
    });
    expect(withoutGrade.statusCode).toBe(201);
    expect(withoutGrade.json<{ data: unknown }>().data).toMatchObject({ grade: null });
  });

  it('borde: la observación sin `note` → 400 VALIDATION_ERROR', async () => {
    const response = await post({ kind: 'observacion', occurredOn: '2026-10-30' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('borde: la evaluación sin `evaluationId` → 400', async () => {
    const response = await post({ kind: 'evaluacion', occurredOn: '2026-10-30' });
    expect(response.statusCode).toBe(400);
  });

  it('borde: `kind` desconocido → 400', async () => {
    const response = await post({ kind: 'otro', occurredOn: '2026-10-30', note: 'x' });
    expect(response.statusCode).toBe(400);
  });

  it('borde: la nota fuera de 1–10 o no entera → 400 (T16)', async () => {
    for (const grade of [0, 11, 7.5]) {
      const response = await post({ kind: 'evaluacion', occurredOn: '2026-10-30', evaluationId: 'e1', grade });
      expect(response.statusCode).toBe(400);
    }
  });

  it('borde: la fecha debe ser de calendario → 400', async () => {
    const response = await post({ kind: 'observacion', occurredOn: '2026-13-40', note: 'x' });
    expect(response.statusCode).toBe(400);
  });

  it('lista la trayectoria del alumno ordenada por fecha', async () => {
    await post({ kind: 'observacion', occurredOn: '2026-10-31', note: 'Segunda.' });
    await post({ kind: 'observacion', occurredOn: '2026-10-30', note: 'Primera.' });

    const response = await get();
    expect(response.statusCode).toBe(200);
    const data = response.json<{ data: Array<{ occurredOn: string; note: string }> }>().data;
    expect(data.map((entry) => entry.note)).toEqual(['Primera.', 'Segunda.']);
  });

  it('borde: aísla por tenant (lo de otro tenant no aparece)', async () => {
    await post({ kind: 'observacion', occurredOn: '2026-10-30', note: 'Privada.' });

    const response = await get('legajo-1', 'docente-2');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('borde: sin alcance → 500 SCOPE_MISSING (fail-closed)', async () => {
    const response = await get('legajo-1', null);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('replay idempotente: reintentar el mismo registro no duplica', async () => {
    const payload = { kind: 'observacion', occurredOn: '2026-10-30', note: 'Una vez.' };
    const headers = { 'x-tenant': TENANT, 'idempotency-key': 'rec-1' };

    const first = await post(payload, headers);
    const second = await post(payload, headers);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const list = await get();
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(1);
  });
});
