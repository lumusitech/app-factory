import { createRequire } from 'node:module';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import {
  createPgliteConnection,
  createPgliteExecutor,
  PgIdempotencyStore,
  PgOutboxPort,
  PgUnitOfWork,
  runMigrations,
  UuidV7Generator,
} from '@kernel/persistence';
import type { SqlExecutor } from '@kernel/persistence';
import { buildScope, requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { NotFoundError } from '../src/errors.js';
import { sendEnvelope } from '../src/reply.js';
import { buildServer } from '../src/server.js';
import { FixedClock } from './support/fakes.js';
import { PgSampleNoteRepository, SampleNote } from './reference/sample-note.js';
import type { SampleNoteRepository } from './reference/sample-note.js';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.dirname(
  require.resolve('@kernel/persistence/migrations/0001-kernel-schema.sql'),
);

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));
const IDS = new UuidV7Generator();

const noteBody = z.object({ title: z.string().min(1) });
const noteResponse = z.object({
  statusCode: z.number().int(),
  data: z.object({ id: z.string(), title: z.string() }),
  timestamp: z.string(),
});

type Repositories = { readonly notes: SampleNoteRepository };

let app: FastifyInstance;
let db: PGlite;
let executor: SqlExecutor;

async function countRows(table: 'sample_note' | 'outbox'): Promise<number> {
  const { rows } = await executor.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return rows[0]?.count ?? -1;
}

beforeEach(async () => {
  db = new PGlite();
  const connection = createPgliteConnection(db);
  executor = createPgliteExecutor(db);

  await runMigrations(connection, { owner: 'kernel-persistence', migrationsDir: MIGRATIONS_DIR });
  await executor.exec(
    `CREATE TABLE sample_note (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      title text NOT NULL,
      version integer NOT NULL
    )`,
  );

  const uow = new PgUnitOfWork<Repositories>(connection, (context) => ({
    notes: new PgSampleNoteRepository(context, new PgOutboxPort(context)),
  }));

  app = await buildServer({
    clock: CLOCK,
    resolveScope: (request) => {
      const tenantId = request.headers['x-tenant'];
      if (typeof tenantId !== 'string' || tenantId === '') {
        return null;
      }
      return buildScope({ tenantId, actor: { kind: 'user', id: 'user-1' } });
    },
    idempotency: { store: new PgIdempotencyStore(connection, CLOCK) },
    openapi: { title: 'kernel-exit', version: '0.1.0' },
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/notes',
    { schema: { body: noteBody, response: { 201: noteResponse } } },
    async (request, reply) => {
      const created = await uow.run(async (repos) => {
        const note = SampleNote.create({
          tenantId: requireScope().tenantId,
          title: request.body.title,
          clock: CLOCK,
          idGenerator: IDS,
        });
        await repos.notes.save(note);
        return note.snapshot();
      });
      sendEnvelope(reply, { id: created.id, title: created.title }, CLOCK, 201);
    },
  );

  typed.post('/notes-rollback', { schema: { body: noteBody } }, async (request) => {
    await uow.run(async (repos) => {
      const note = SampleNote.create({
        tenantId: requireScope().tenantId,
        title: request.body.title,
        clock: CLOCK,
        idGenerator: IDS,
      });
      await repos.notes.save(note);
      throw new Error('fallo después de guardar');
    });
  });

  typed.get(
    '/notes/:id',
    { schema: { params: z.object({ id: z.string() }), response: { 200: noteResponse } } },
    async (request, reply) => {
      const note = await uow.run(async (repos) => repos.notes.byId(request.params.id));
      if (note === null) {
        throw new NotFoundError('Nota no encontrada.');
      }
      sendEnvelope(reply, { id: note.id, title: note.title }, CLOCK);
    },
  );
});

afterEach(async () => {
  await app.close();
  await db.close();
});

describe('criterio de salida de la fase 2: persiste, emite outbox y respeta alcance', () => {
  it('el agregado con invariantes persiste y emite el evento en la misma transacción', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: 'Mi nota' },
    });

    expect(response.statusCode).toBe(201);
    const created = response.json<{ data: { id: string; title: string } }>().data;
    expect(created.title).toBe('Mi nota');

    expect(await countRows('sample_note')).toBe(1);
    expect(await countRows('outbox')).toBe(1);

    const note = await executor.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM sample_note WHERE id = $1',
      [created.id],
    );
    expect(note.rows[0]?.tenant_id).toBe('tenant-a');

    const event = await executor.query<{ tenant_id: string; type: string; payload: { title: string } }>(
      'SELECT tenant_id, type, payload FROM outbox',
    );
    expect(event.rows[0]?.tenant_id).toBe('tenant-a');
    expect(event.rows[0]?.type).toBe('sample-note.created');
    expect(event.rows[0]?.payload).toEqual({ title: 'Mi nota' });
  });

  it('replay: la misma Idempotency-Key no duplica el agregado ni el evento', async () => {
    const headers = { 'x-tenant': 'tenant-a', 'idempotency-key': 'k1' };
    const payload = { title: 'Mi nota' };

    const first = await app.inject({ method: 'POST', url: '/notes', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/notes', headers, payload });

    expect(first.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await countRows('sample_note')).toBe(1);
    expect(await countRows('outbox')).toBe(1);
  });

  it('respeta alcance: el agregado de otro tenant no se ve (filtro de aplicación)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: 'Privada de A' },
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    const own = await app.inject({ method: 'GET', url: `/notes/${id}`, headers: { 'x-tenant': 'tenant-a' } });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ data: { id } });

    const foreign = await app.inject({ method: 'GET', url: `/notes/${id}`, headers: { 'x-tenant': 'tenant-b' } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('borde: sin alcance la consulta falla cerrada (ScopeMissingError)', async () => {
    const response = await app.inject({ method: 'GET', url: '/notes/cualquiera' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('rollback: si la transacción falla, ni el agregado ni el evento persisten', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/notes-rollback',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: 'No debería persistir' },
    });

    expect(response.statusCode).toBe(500);
    expect(await countRows('sample_note')).toBe(0);
    expect(await countRows('outbox')).toBe(0);
  });

  it('borde: la invariante del agregado rechaza un título en blanco y no persiste nada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: '     ' },
    });

    expect(response.statusCode).toBe(500);
    expect(await countRows('sample_note')).toBe(0);
    expect(await countRows('outbox')).toBe(0);
  });
});