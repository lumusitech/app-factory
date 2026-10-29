import { createRequire } from 'node:module';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import {
  InMemoryGetCacheStore,
  InMemoryQueueStore,
  ManualScheduler,
  SyncClient,
  TransportConnectivityProbe,
} from '@kernel/client';
import type { Transport, TransportRequest, TransportResult } from '@kernel/client';
import type { Clock, IdGenerator } from '@kernel/domain';
import {
  HttpError,
  NotFoundError,
  buildServer,
  registerProbeRoute,
  resolveVersionConflict,
  sendEnvelope,
  syncVersionConflictError,
} from '@kernel/http';
import {
  PgIdempotencyStore,
  PgOutboxPort,
  PgUnitOfWork,
  UuidV7Generator,
  createPgliteConnection,
  createPgliteExecutor,
  runMigrations,
} from '@kernel/persistence';
import type { SqlExecutor } from '@kernel/persistence';
import { buildScope, requireScope } from '@kernel/scope';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Note, PgNoteRepository, versionToken } from '../reference/note.js';
import type { NoteRepository } from '../reference/note.js';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.dirname(
  require.resolve('@kernel/persistence/migrations/0001-kernel-schema.sql'),
);

/** Reloj determinista compartido por servidor y cliente en la suite. */
export class FixedClock implements Clock {
  #value: Date;

  constructor(start: Date) {
    this.#value = start;
  }

  now(): Date {
    return this.#value;
  }

  advance(ms: number): void {
    this.#value = new Date(this.#value.getTime() + ms);
  }
}

interface InjectTransportOptions {
  readonly headers: Record<string, string>;
}

/** Transporte del cliente contra el servidor **en proceso** (`fastify.inject`, D4). */
export class InjectTransport implements Transport {
  readonly headers: Record<string, string>;

  constructor(
    private readonly app: FastifyInstance,
    options: InjectTransportOptions,
  ) {
    this.headers = { ...options.headers };
  }

  async send(request: TransportRequest): Promise<TransportResult> {
    const response = await this.app.inject({
      method: request.method,
      url: request.path,
      headers: { ...this.headers, ...request.headers },
      ...(request.body === null || request.body === undefined ? {} : { payload: request.body }),
    });
    return { kind: 'response', statusCode: response.statusCode, body: parseBody(response.body) };
  }
}

/**
 * Envuelve un transporte y permite simular fallos: `online = false` (error de
 * red inmediato) y `hang = true` (el intento nunca responde → lo corta el
 * watchdog).
 */
export class ToggleTransport implements Transport {
  online = true;
  hang = false;

  constructor(private readonly inner: Transport) {}

  async send(request: TransportRequest): Promise<TransportResult> {
    if (this.hang) {
      return new Promise<TransportResult>(() => undefined);
    }
    if (!this.online) {
      return { kind: 'network-error', error: new Error('sin conexión (simulado)') };
    }
    return this.inner.send(request);
  }
}

function parseBody(raw: string): unknown {
  if (raw === '') {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

const noteBody = z.object({ title: z.string().min(1) });
const noteResponse = z.object({
  statusCode: z.number().int(),
  data: z.object({ id: z.string(), title: z.string(), version: z.number().int() }),
  timestamp: z.string(),
});

/** Tipo (no interface): `query<T>` exige un alias con índice implícito. */
export type NoteRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly title: string;
  readonly version: number;
};

export interface ConformanceHarness {
  readonly app: FastifyInstance;
  readonly db: PGlite;
  readonly executor: SqlExecutor;
  readonly client: SyncClient;
  readonly scheduler: ManualScheduler;
  readonly clock: FixedClock;
  readonly queueStore: InMemoryQueueStore;
  readonly cacheStore: InMemoryGetCacheStore;
  readonly transport: ToggleTransport;
  readonly injectTransport: InjectTransport;
  countNotes(): Promise<number>;
  countOutbox(): Promise<number>;
  noteRow(id: string): Promise<NoteRow | null>;
  close(): Promise<void>;
}

/**
 * Arma el kernel completo —borde (`kernel-http`), persistencia (PGlite sin
 * contenedor, D4), alcance y el cliente (`kernel-client`)— con un agregado de
 * referencia. Es el escenario de la suite de convergencia (§7, fase 3).
 */
export async function createHarness(): Promise<ConformanceHarness> {
  const clock = new FixedClock(new Date('2026-10-29T12:00:00.000Z'));
  const ids: IdGenerator = new UuidV7Generator();

  const db = new PGlite();
  const connection = createPgliteConnection(db);
  const executor = createPgliteExecutor(db);

  await runMigrations(connection, { owner: 'kernel-persistence', migrationsDir: MIGRATIONS_DIR });
  await executor.exec(
    `CREATE TABLE conformance_note (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      title text NOT NULL,
      version integer NOT NULL
    )`,
  );

  const uow = new PgUnitOfWork<{ notes: NoteRepository }>(connection, (context) => ({
    notes: new PgNoteRepository(context, new PgOutboxPort(context)),
  }));

  const app = await buildServer({
    clock,
    resolveScope: (request) => {
      const tenantId = request.headers['x-tenant'];
      if (typeof tenantId !== 'string' || tenantId === '') {
        return null;
      }
      return buildScope({ tenantId, actor: { kind: 'user', id: 'user-1' } });
    },
    idempotency: { store: new PgIdempotencyStore(connection, clock) },
    openapi: { title: 'kernel-conformance', version: '0.1.0' },
  });

  registerProbeRoute(app, clock);
  registerReferenceRoutes(app, uow, clock, ids);

  const injectTransport = new InjectTransport(app, { headers: { 'x-tenant': 'tenant-a' } });
  const transport = new ToggleTransport(injectTransport);

  const queueStore = new InMemoryQueueStore();
  const cacheStore = new InMemoryGetCacheStore();
  const scheduler = new ManualScheduler();

  const client = new SyncClient({
    clock,
    idGenerator: ids,
    queue: queueStore,
    transport,
    scheduler,
    getCache: { store: cacheStore },
    connectivity: new TransportConnectivityProbe(transport, { path: '/probe' }),
  });

  return {
    app,
    db,
    executor,
    client,
    scheduler,
    clock,
    queueStore,
    cacheStore,
    transport,
    injectTransport,
    async countNotes(): Promise<number> {
      const { rows } = await executor.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM conformance_note',
      );
      return rows[0]?.count ?? -1;
    },
    async countOutbox(): Promise<number> {
      const { rows } = await executor.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM outbox',
      );
      return rows[0]?.count ?? -1;
    },
    async noteRow(id: string): Promise<NoteRow | null> {
      const { rows } = await executor.query<NoteRow>(
        'SELECT id, tenant_id, title, version FROM conformance_note WHERE id = $1',
        [id],
      );
      return rows[0] ?? null;
    },
    close: () => Promise.all([app.close(), db.close()]).then(() => undefined),
  };
}

interface Repositories {
  readonly notes: NoteRepository;
}

type UnitOfWork = PgUnitOfWork<Repositories>;

interface RenameRequest {
  readonly params: { readonly id: string };
  readonly body: { readonly title: string };
  readonly headers: Record<string, unknown>;
}

function readBaseVersion(request: { readonly headers: Record<string, unknown> }): string | null {
  const raw = request.headers['x-sync-base-version'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : null;
}

function registerReferenceRoutes(
  app: FastifyInstance,
  uow: UnitOfWork,
  clock: Clock,
  ids: IdGenerator,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/notes', { schema: { body: noteBody, response: { 201: noteResponse } } }, async (request, reply) => {
    const created = await uow.run(async (repos) => {
      const note = Note.create({
        tenantId: requireScope().tenantId,
        title: request.body.title,
        clock,
        idGenerator: ids,
      });
      await repos.notes.save(note);
      return note.snapshot();
    });
    sendEnvelope(reply, created, clock, 201);
  });

  typed.get(
    '/notes/:id',
    {
      schema: { params: z.object({ id: z.string() }), response: { 200: noteResponse } },
    },
    async (request, reply) => {
      const note = await uow.run(async (repos) => repos.notes.byId(request.params.id));
      if (note === null) {
        throw new NotFoundError('Nota no encontrada.');
      }
      sendEnvelope(reply, note.snapshot(), clock);
    },
  );

  // Rename bajo política `lww` (opt-in, sync §8.2).
  typed.patch(
    '/notes/:id',
    { schema: { params: z.object({ id: z.string() }), body: noteBody } },
    renameHandler(uow, clock, ids, 'lww'),
  );

  // Rename bajo política `blocked` (default del kernel, sync §8.2).
  typed.patch(
    '/locked-notes/:id',
    { schema: { params: z.object({ id: z.string() }), body: noteBody } },
    renameHandler(uow, clock, ids, 'blocked'),
  );

  typed.post('/session-refresh', async () => {
    throw new HttpError('UNAUTHORIZED', 'Sesión inválida.', 401);
  });

  typed.post('/boom', async () => {
    throw new Error('fallo interno simulado');
  });
}

function renameHandler(
  uow: UnitOfWork,
  clock: Clock,
  ids: IdGenerator,
  policy: 'blocked' | 'lww',
): (request: RenameRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const scope = requireScope();
    const baseVersion = readBaseVersion(request);

    await uow.run(async (repos) => {
      const note = await repos.notes.byId(request.params.id);
      if (note === null) {
        throw new NotFoundError('Nota no encontrada.');
      }

      const resolution = resolveVersionConflict({
        baseVersion,
        currentVersion: versionToken(note),
        policy,
        actor: scope.actor.id,
        deviceLabel: 'conformance · inject',
        clock,
      });

      if (resolution.kind === 'blocked') {
        throw syncVersionConflictError();
      }

      const renamed = note.rename({ title: request.body.title, clock, idGenerator: ids });
      await repos.notes.save(renamed);

      if (resolution.kind === 'lww') {
        sendEnvelope(reply, renamed.snapshot(), clock, 200, resolution.signal);
      } else {
        sendEnvelope(reply, renamed.snapshot(), clock);
      }
    });
  };
}
