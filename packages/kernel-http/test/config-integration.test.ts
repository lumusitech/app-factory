import { createRequire } from 'node:module';
import path from 'node:path';

import type { ConfigSchemaRegistry, ConfigValue } from '@kernel/config';
import {
  ConfigEntry,
  ConfigService,
  InvalidConfigKeyError,
  InvalidConfigValueError,
  UnknownConfigKeyError,
} from '@kernel/config';
import { PGlite } from '@electric-sql/pglite';
import {
  PgConfigEntryRepository,
  PgOutboxPort,
  PgUnitOfWork,
  UuidV7Generator,
  createPgliteConnection,
  createPgliteExecutor,
  runMigrations,
} from '@kernel/persistence';
import type { SqlExecutor } from '@kernel/persistence';
import { buildScope, requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { HttpError, NotFoundError } from '../src/errors.js';
import { sendEnvelope } from '../src/reply.js';
import { buildServer } from '../src/server.js';
import { FixedClock } from './support/fakes.js';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.dirname(
  require.resolve('@kernel/persistence/migrations/0001-kernel-schema.sql'),
);

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));
const IDS = new UuidV7Generator();

/**
 * Catálogo de la **vertical** (ADR 0007): claves, versiones de esquema y
 * validación. `kernel-config` no lo conoce; se lo inyecta el producto.
 */
const CATALOG: Record<string, { readonly version: number; readonly accepts: (value: ConfigValue) => boolean }> = {
  'grading.thresholds': {
    version: 1,
    accepts: (value) => typeof value === 'number' && value >= 1 && value <= 10,
  },
};

const registry: ConfigSchemaRegistry = {
  currentVersion: (key) => CATALOG[key]?.version ?? null,
  isValid: (key, schemaVersion, value) => {
    const spec = CATALOG[key];
    if (spec === undefined || spec.version !== schemaVersion) {
      return false;
    }
    return spec.accepts(value);
  },
};

type Repositories = { readonly config: PgConfigEntryRepository };

let app: FastifyInstance;
let db: PGlite;
let executor: SqlExecutor;
let uow: PgUnitOfWork<Repositories>;

/** Traduce los errores de dominio de config al catálogo del borde (lo hace el producto). */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (
      error instanceof InvalidConfigValueError ||
      error instanceof UnknownConfigKeyError ||
      error instanceof InvalidConfigKeyError
    ) {
      throw new HttpError('VALIDATION_ERROR', error.message);
    }
    throw error;
  }
}

const withConfig = <T>(work: (service: ConfigService) => Promise<T>): Promise<T> =>
  uow.run(async (repos) =>
    work(new ConfigService({ repository: repos.config, registry, clock: CLOCK, idGenerator: IDS })),
  );

const entryView = (entry: ConfigEntry) => ({
  key: entry.key,
  value: entry.value,
  schemaVersion: entry.schemaVersion,
});

beforeEach(async () => {
  db = new PGlite();
  executor = createPgliteExecutor(db);
  await runMigrations(createPgliteConnection(db), {
    owner: 'kernel-persistence',
    migrationsDir: MIGRATIONS_DIR,
  });

  uow = new PgUnitOfWork<Repositories>(createPgliteConnection(db), (context) => ({
    config: new PgConfigEntryRepository(context, new PgOutboxPort(context)),
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
    openapi: { title: 'kernel-config', version: '0.1.0' },
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/config/:key', { schema: { params: z.object({ key: z.string() }) } }, async (request, reply) => {
    const entry = await guard(() => withConfig((service) => service.get(request.params.key)));
    if (entry === null) {
      throw new NotFoundError('Configuración no encontrada.');
    }
    sendEnvelope(reply, entryView(entry), CLOCK);
  });

  typed.put(
    '/config/:key',
    { schema: { params: z.object({ key: z.string() }), body: z.object({ value: z.unknown() }) } },
    async (request, reply) => {
      const entry = await guard(() =>
        withConfig((service) =>
          service.set({ key: request.params.key, value: request.body.value as ConfigValue }),
        ),
      );
      sendEnvelope(reply, entryView(entry), CLOCK);
    },
  );

  typed.put(
    '/config-rollback/:key',
    { schema: { params: z.object({ key: z.string() }), body: z.object({ value: z.unknown() }) } },
    async (request) => {
      await uow.run(async (repos) => {
        const entry = ConfigEntry.create({
          tenantId: requireScope().tenantId,
          key: request.params.key,
          value: request.body.value as ConfigValue,
          registry,
          clock: CLOCK,
          idGenerator: IDS,
        });
        await repos.config.save(entry);
        throw new Error('fallo después de guardar');
      });
    },
  );
});

afterEach(async () => {
  await app.close();
  await db.close();
});

async function countRows(table: 'config_entry' | 'outbox'): Promise<number> {
  const { rows } = await executor.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return rows[0]?.count ?? -1;
}

const put = (key: string, value: unknown, tenant = 'tenant-a', url = '/config') =>
  app.inject({
    method: 'PUT',
    url: `${url}/${key}`,
    headers: { 'x-tenant': tenant },
    payload: { value },
  });

describe('configuración por tenant extremo a extremo (kernel-config + persistence + http)', () => {
  it('persiste la entrada, emite el evento y responde el envelope', async () => {
    const response = await put('grading.thresholds', 7);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      statusCode: 200,
      data: { key: 'grading.thresholds', value: 7, schemaVersion: 1 },
    });

    expect(await countRows('config_entry')).toBe(1);
    expect(await countRows('outbox')).toBe(1);

    const event = await executor.query<{ type: string; payload: { key: string; value: number } }>(
      'SELECT type, payload FROM outbox',
    );
    expect(event.rows[0]?.type).toBe('config.entry.created');
    expect(event.rows[0]?.payload).toEqual({ key: 'grading.thresholds', schemaVersion: 1, value: 7 });
  });

  it('lee la configuración por su clave', async () => {
    await put('grading.thresholds', 7);

    const response = await app.inject({
      method: 'GET',
      url: '/config/grading.thresholds',
      headers: { 'x-tenant': 'tenant-a' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { value: 7, schemaVersion: 1 } });
  });

  it('borde: un set con el mismo valor no emite un segundo evento', async () => {
    await put('grading.thresholds', 7);
    await put('grading.thresholds', 7);

    expect(await countRows('config_entry')).toBe(1);
    expect(await countRows('outbox')).toBe(1);
  });

  it('respeta alcance: la config de otro tenant no se ve (404)', async () => {
    await put('grading.thresholds', 7, 'tenant-a');

    const foreign = await app.inject({
      method: 'GET',
      url: '/config/grading.thresholds',
      headers: { 'x-tenant': 'tenant-b' },
    });

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('borde: sin alcance la operación falla cerrada (ScopeMissingError)', async () => {
    const response = await app.inject({ method: 'GET', url: '/config/grading.thresholds' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('borde: un valor fuera del esquema se rechaza y no persiste nada', async () => {
    const response = await put('grading.thresholds', 99);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
    expect(await countRows('config_entry')).toBe(0);
  });

  it('borde: una clave no registrada se rechaza y no persiste nada', async () => {
    const response = await put('no.existe', 1);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
    expect(await countRows('config_entry')).toBe(0);
  });

  it('borde: rollback no deja ni la entrada ni el evento', async () => {
    const response = await put('grading.thresholds', 7, 'tenant-a', '/config-rollback');

    expect(response.statusCode).toBe(500);
    expect(await countRows('config_entry')).toBe(0);
    expect(await countRows('outbox')).toBe(0);
  });
});