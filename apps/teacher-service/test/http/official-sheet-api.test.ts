import type { Clock } from '@kernel/domain';
import { createPgliteConnection } from '@kernel/persistence';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { headerSessionResolver } from '../../src/identity.js';
import { runAppMigrations } from '../../src/migrations.js';

/**
 * Borde de la planilla oficial (F-04; ADR 0014): `GET
 * /courses/:courseId/official-sheet.pdf`. Cubre el **render en el servidor**
 * (PDF binario fuera del envelope), el **alcance** (cross-tenant y fail-closed),
 * el **curso vacío**, los **límites**, la cabecera opaca y la **plantilla como
 * dato** (override por `kernel-config` y fail-closed ante una plantilla inválida).
 */

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-29T12:00:00.000Z');
  }
}

const TENANT = 'docente-1';
const COURSE = 'curso-3-1';
const TEMPLATE_KEY = 'document.template.pba-secondary-2026';

function decode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

let db: PGlite;
let app: FastifyInstance;

beforeEach(async () => {
  db = new PGlite();
  const connection = createPgliteConnection(db);
  await runAppMigrations(connection);
  app = await buildApp({ connection, clock: new FixedClock(), resolver: headerSessionResolver });
});

afterEach(async () => {
  await app.close();
  await db.close();
});

async function seed(): Promise<void> {
  await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT]);
  await db.query(
    `INSERT INTO evaluation (id, tenant_id, course_id, name, period, weight, version)
     VALUES ('e1', $1, $2, 'Parcial', 'C1', 1, 1)`,
    [TENANT, COURSE],
  );
  await db.query(
    `INSERT INTO grade_entry (evaluation_id, tenant_id, student_id, value)
     VALUES ('e1', $1, 'legajo-1', 7)`,
    [TENANT],
  );
  await db.query(
    `INSERT INTO trajectory_assessment_entry (course_id, period, tenant_id, student_id, rating)
     VALUES ($1, 'C1', $2, 'legajo-1', 'TEA')`,
    [COURSE, TENANT],
  );
  await db.query(
    `INSERT INTO class_session (id, tenant_id, course_id, date, status, version)
     VALUES ('c1', $1, $2, '2026-05-02', 'dictada', 1)`,
    [TENANT, COURSE],
  );
  await db.query(
    `INSERT INTO attendance_entry (class_session_id, tenant_id, student_id, status)
     VALUES ('c1', $1, 'legajo-1', 'ausente')`,
    [TENANT],
  );
}

function get(query = '', tenant: string | null = TENANT) {
  return app.inject({
    method: 'GET',
    url: `/courses/${COURSE}/official-sheet.pdf${query}`,
    headers: tenant === null ? {} : { 'x-tenant': tenant },
  });
}

describe('GET /courses/:courseId/official-sheet.pdf (F-04, ADR 0014)', () => {
  it('devuelve un PDF (application/pdf) fuera del envelope JSON', async () => {
    await seed();
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    const pdf = decode(response.rawPayload);
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('Planilla oficial');
    expect(pdf).toContain('(legajo-1) Tj');
    expect(pdf).toContain('(7) Tj');
    expect(pdf).toContain('(TEA) Tj');
    // No es el envelope del kernel.
    expect(pdf).not.toContain('"statusCode"');
  });

  it('es determinista entre dos pedidos con el mismo reloj', async () => {
    await seed();
    const first = await get();
    const second = await get();
    expect(first.rawPayload.equals(second.rawPayload)).toBe(true);
  });

  it('borde: curso vacío → PDF válido sin filas', async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    const pdf = decode(response.rawPayload);
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).not.toContain('(legajo-1) Tj');
  });

  it('borde: aísla por tenant (los datos de otro tenant no aparecen)', async () => {
    await seed();
    const response = await get('', 'docente-2');
    expect(response.statusCode).toBe(200);
    expect(decode(response.rawPayload)).not.toContain('(legajo-1) Tj');
  });

  it('borde: sin alcance → 500 SCOPE_MISSING (fail-closed)', async () => {
    const response = await get('', null);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('borde: courseId inválido → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/courses/%20/official-sheet.pdf',
      headers: { 'x-tenant': TENANT },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('mapea la cabecera opaca (query params) al PDF', async () => {
    await seed();
    const response = await get('?school=EES%2012&subject=Matem%C3%A1tica&cycle=2026');
    const pdf = decode(response.rawPayload);
    expect(pdf).toContain('EES 12');
    expect(pdf).toContain('Matemática');
  });

  it('borde: la plantilla es dato — el override por kernel-config cambia el título', async () => {
    await seed();
    await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT]);
    await db.query(
      `INSERT INTO config_entry (tenant_id, key, value, schema_version, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, now())`,
      [
        TENANT,
        TEMPLATE_KEY,
        JSON.stringify({
          id: 'otra',
          jurisdiction: 'PBA',
          level: 'secundaria',
          year: 2026,
          title: 'Plantilla del tenant',
          header: [],
          columns: [{ kind: 'grade', label: 'Nota C1', period: 'C1' }],
        }),
      ],
    );

    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(decode(response.rawPayload)).toContain('Plantilla del tenant');
  });

  it('borde: una plantilla almacenada inválida falla cerrado (500)', async () => {
    await seed();
    await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT]);
    await db.query(
      `INSERT INTO config_entry (tenant_id, key, value, schema_version, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, now())`,
      [TENANT, TEMPLATE_KEY, JSON.stringify({ id: 'invalida', columns: [] })],
    );

    const response = await get();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });
});
