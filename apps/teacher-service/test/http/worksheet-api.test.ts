import type { Clock } from '@kernel/domain';
import { createPgliteConnection } from '@kernel/persistence';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { headerSessionResolver } from '../../src/identity.js';
import { runAppMigrations } from '../../src/migrations.js';

/**
 * Borde de la planilla de uso diario (ADR 0017): `GET
 * /courses/:courseId/worksheet.pdf` (matriz) y `GET
 * /courses/:courseId/students/:studentId/worksheet.pdf` (bloque). Cubre el
 * **render en el servidor** (PDF binario fuera del envelope), el **alcance**
 * (cross-tenant y fail-closed), el **curso vacío**, los **límites**, el **rango
 * opaco de fechas**, la cabecera opaca y la **plantilla como dato**.
 */

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-30T12:00:00.000Z');
  }
}

const TENANT = 'docente-1';
const COURSE = 'curso-3-1';
const TEMPLATE_KEY = 'document.template.worksheet-pba-secondary-2026';

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
     VALUES ('e1', $1, $2, 'Parcial', 'C1', 1, 1), ('e2', $1, $2, 'TP', 'C1', 1, 1)`,
    [TENANT, COURSE],
  );
  await db.query(
    `INSERT INTO grade_entry (evaluation_id, tenant_id, student_id, value)
     VALUES ('e1', $1, 'legajo-1', 7), ('e2', $1, 'legajo-2', 4)`,
    [TENANT],
  );
  await db.query(
    `INSERT INTO trajectory_assessment_entry (course_id, period, tenant_id, student_id, rating)
     VALUES ($1, 'C1', $2, 'legajo-1', 'TEA')`,
    [COURSE, TENANT],
  );
  await db.query(
    `INSERT INTO class_session (id, tenant_id, course_id, date, status, version)
     VALUES ('c1', $1, $2, '2026-05-02', 'dictada', 1),
            ('c2', $1, $2, '2026-05-09', 'dictada', 1),
            ('c3', $1, $2, '2026-04-01', 'dictada', 1)`,
    [TENANT, COURSE],
  );
  await db.query(
    `INSERT INTO attendance_entry (class_session_id, tenant_id, student_id, status)
     VALUES ('c1', $1, 'legajo-1', 'presente'), ('c2', $1, 'legajo-1', 'ausente'), ('c3', $1, 'legajo-2', 'presente')`,
    [TENANT],
  );
  await db.query(
    `INSERT INTO period_closing_entry (course_id, period, tenant_id, student_id, value, motive)
     VALUES ($1, 'C1', $2, 'legajo-2', 8, 'recuperatorio')`,
    [COURSE, TENANT],
  );
  await db.query(
    `INSERT INTO student_record (id, tenant_id, student_id, kind, occurred_on, note, evaluation_id, grade, version)
     VALUES ('r1', $1, 'legajo-1', 'evaluacion', '2026-05-10', 'ok', 'e1', 7, 1)`,
    [TENANT],
  );
}

function get(url: string, tenant: string | null = TENANT) {
  return app.inject({
    method: 'GET',
    url,
    headers: tenant === null ? {} : { 'x-tenant': tenant },
  });
}

function sheet(query = 'period=C1') {
  return get(`/courses/${COURSE}/worksheet.pdf?${query}`);
}

function student(legajo: string, query = 'period=C1') {
  return get(`/courses/${COURSE}/students/${legajo}/worksheet.pdf?${query}`);
}

describe('GET /courses/:courseId/worksheet.pdf (matriz; ADR 0017)', () => {
  it('devuelve un PDF (application/pdf) fuera del envelope JSON', async () => {
    await seed();
    const response = await sheet();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    const pdf = decode(response.rawPayload);
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('Planilla de uso diario');
    expect(pdf).toContain('(legajo-1) Tj');
    expect(pdf).toContain('(Parcial) Tj');
    expect(pdf).toContain('(TEA) Tj');
    expect(pdf).toContain('(presente) Tj');
    expect(pdf).toContain('(8 M) Tj');
    expect(pdf).not.toContain('"statusCode"');
  });

  it('es determinista entre dos pedidos con el mismo reloj', async () => {
    await seed();
    const first = await sheet();
    const second = await sheet();
    expect(first.rawPayload.equals(second.rawPayload)).toBe(true);
  });

  it('borde: curso vacío → PDF válido sin filas', async () => {
    const response = await sheet();
    expect(response.statusCode).toBe(200);
    const pdf = decode(response.rawPayload);
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).not.toContain('(legajo-1) Tj');
  });

  it('borde: el rango opaco de fechas acota las columnas de asistencia', async () => {
    await seed();
    const all = decode((await sheet()).rawPayload);
    expect(all).toContain('(2026-04-01) Tj');

    const ranged = decode((await sheet('period=C1&from=2026-05-01&to=2026-05-31')).rawPayload);
    expect(ranged).not.toContain('(2026-04-01) Tj');
    expect(ranged).toContain('(2026-05-02) Tj');
  });

  it('borde: rango vacío (from > to) → PDF válido sin columnas de fecha', async () => {
    await seed();
    const response = await sheet('period=C1&from=2026-06-01&to=2026-05-01');
    expect(response.statusCode).toBe(200);
    expect(decode(response.rawPayload).startsWith('%PDF-1.7')).toBe(true);
  });

  it('borde: aísla por tenant (los datos de otro tenant no aparecen)', async () => {
    await seed();
    const response = await get(`/courses/${COURSE}/worksheet.pdf?period=C1`, 'docente-2');
    expect(response.statusCode).toBe(200);
    expect(decode(response.rawPayload)).not.toContain('(legajo-1) Tj');
  });

  it('borde: sin alcance → 500 SCOPE_MISSING (fail-closed)', async () => {
    const response = await get(`/courses/${COURSE}/worksheet.pdf?period=C1`, null);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('borde: sin período → 400 VALIDATION_ERROR', async () => {
    const response = await get(`/courses/${COURSE}/worksheet.pdf`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('borde: fecha de rango inválida → 400 VALIDATION_ERROR', async () => {
    const response = await sheet('period=C1&from=2026-13-40');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('mapea la cabecera opaca (query params) y el período al PDF', async () => {
    await seed();
    const response = await sheet('period=C1&school=EES%2012&subject=Matem%C3%A1tica&cycle=2026');
    const pdf = decode(response.rawPayload);
    expect(pdf).toContain('EES 12');
    expect(pdf).toContain('Matemática');
    expect(pdf).toContain('Período: C1');
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
          title: 'Hoja del tenant',
          header: [],
          sections: [{ kind: 'attendance', label: 'Asistencia' }],
        }),
      ],
    );

    const response = await sheet();
    expect(response.statusCode).toBe(200);
    expect(decode(response.rawPayload)).toContain('Hoja del tenant');
  });

  it('borde: una plantilla almacenada inválida falla cerrado (500)', async () => {
    await seed();
    await db.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT]);
    await db.query(
      `INSERT INTO config_entry (tenant_id, key, value, schema_version, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, now())`,
      [TENANT, TEMPLATE_KEY, JSON.stringify({ id: 'invalida', sections: [] })],
    );

    const response = await sheet();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });
});

describe('GET /courses/:courseId/students/:studentId/worksheet.pdf (bloque; ADR 0017)', () => {
  it('rinde el seguimiento de un solo alumno', async () => {
    await seed();
    const response = await student('legajo-1');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    const pdf = decode(response.rawPayload);
    expect(pdf).toContain('Alumno: legajo-1');
    expect(pdf).toContain('Parcial');
    expect(pdf).toContain('TEA');
    expect(pdf).not.toContain('Alumno: legajo-2');
  });

  it('borde: alumno sin datos → bloque válido con secciones vacías', async () => {
    await seed();
    const response = await student('legajo-999');
    expect(response.statusCode).toBe(200);
    const pdf = decode(response.rawPayload);
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('Alumno: legajo-999');
  });

  it('borde: sin alcance → 500 SCOPE_MISSING (fail-closed)', async () => {
    const response = await get(
      `/courses/${COURSE}/students/legajo-1/worksheet.pdf?period=C1`,
      null,
    );
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });
});
