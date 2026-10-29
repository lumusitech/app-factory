import { PGlite } from '@electric-sql/pglite';
import { InMemoryGetCacheStore, InMemoryQueueStore, ManualScheduler } from '@kernel/client';
import type { Transport, TransportRequest, TransportResult } from '@kernel/client';
import type { Clock } from '@kernel/domain';
import { HttpError } from '@kernel/http';
import { UuidV7Generator, createPgliteConnection } from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';
import type { SyncClient } from '@kernel/client';

import { buildApp } from '../../../src/app.js';
import { headerSessionResolver } from '../../../src/identity.js';
import { runAppMigrations } from '../../../src/migrations.js';
import { createClassSessionSync } from '../../../src/sync/class-session-sync.js';
import type { ClassSessionSync } from '../../../src/sync/class-session-sync.js';

/** Tenant fijo del docente dueño de la captura (T1). */
export const TENANT = 'docente-1';
/** Etiqueta de dispositivo que el servidor deriva de `user-agent` (sync §8.2). */
export const DEVICE_LABEL = 'teacher-sync-test';

/** Reloj determinista compartido por servidor y cliente. */
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

/** Transporte del cliente contra el servidor **en proceso** (`fastify.inject`, D4). */
export class InjectTransport implements Transport {
  readonly headers: Record<string, string>;

  constructor(
    private readonly app: FastifyInstance,
    headers: Record<string, string>,
  ) {
    this.headers = { ...headers };
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
 * Envuelve un transporte y permite simular fallos (sync §10): `online = false`
 * (error de red inmediato) y `hang = true` (el intento nunca responde → lo corta
 * el watchdog).
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

export type SessionRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly course_id: string;
  readonly date: string;
  readonly status: string;
  readonly cancellation_reason: string | null;
  readonly version: number;
};

export interface TeacherSyncHarness {
  readonly app: FastifyInstance;
  readonly db: PGlite;
  readonly sync: ClassSessionSync;
  readonly client: SyncClient;
  readonly scheduler: ManualScheduler;
  readonly clock: FixedClock;
  readonly queueStore: InMemoryQueueStore;
  readonly cacheStore: InMemoryGetCacheStore;
  readonly transport: ToggleTransport;
  countSessions(): Promise<number>;
  countOutbox(): Promise<number>;
  sessionRow(id: string): Promise<SessionRow | null>;
  close(): Promise<void>;
}

/**
 * Arma la vertical completa —borde HTTP, PGlite sin contenedor (D4), identidad,
 * y el cliente offline cableado por `createClassSessionSync` (fase 5)— para el
 * escenario de aceptación de convergencia (§7). Los adaptadores son en memoria:
 * el adaptador IndexedDB está diferido (ADR 0008 §2).
 */
export async function createTeacherSyncHarness(): Promise<TeacherSyncHarness> {
  const clock = new FixedClock(new Date('2026-10-29T12:00:00.000Z'));
  const idGenerator = new UuidV7Generator();

  const db = new PGlite();
  const connection = createPgliteConnection(db);
  await runAppMigrations(connection);

  const app = await buildApp({
    connection,
    clock,
    resolver: headerSessionResolver,
    idGenerator,
  });

  // Rutas **test-only**: simulan respuestas que en producción emite una capa
  // fuera del corte (auth → 401; fallo interno → 5xx). No modifican producción.
  app.patch('/class-sessions/expired-session', async () => {
    throw new HttpError('UNAUTHORIZED', 'Sesión inválida.', 401);
  });
  app.patch('/class-sessions/boom', async () => {
    throw new Error('fallo interno simulado');
  });
  app.put('/class-sessions/expired-session/attendance', async () => {
    throw new HttpError('UNAUTHORIZED', 'Sesión inválida.', 401);
  });
  app.put('/class-sessions/boom/attendance', async () => {
    throw new Error('fallo interno simulado');
  });

  const injectTransport = new InjectTransport(app, {
    'x-tenant': TENANT,
    'user-agent': DEVICE_LABEL,
  });
  const transport = new ToggleTransport(injectTransport);

  const queueStore = new InMemoryQueueStore();
  const cacheStore = new InMemoryGetCacheStore();
  const scheduler = new ManualScheduler();

  const sync = createClassSessionSync({
    clock,
    idGenerator,
    queue: queueStore,
    transport,
    scheduler,
    getCache: { store: cacheStore },
  });

  return {
    app,
    db,
    sync,
    client: sync.client,
    scheduler,
    clock,
    queueStore,
    cacheStore,
    transport,
    async countSessions(): Promise<number> {
      const { rows } = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM class_session',
      );
      return rows[0]?.count ?? -1;
    },
    async countOutbox(): Promise<number> {
      const { rows } = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM outbox',
      );
      return rows[0]?.count ?? -1;
    },
    async sessionRow(id: string): Promise<SessionRow | null> {
      const { rows } = await db.query<SessionRow>(
        `SELECT id, tenant_id, course_id, date, status, cancellation_reason, version
           FROM class_session WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },
    close: () => Promise.all([app.close(), db.close()]).then(() => undefined),
  };
}
