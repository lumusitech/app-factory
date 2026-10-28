import { buildScope } from '@kernel/scope';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MemoryIdempotencyStore } from '../../test/support/fakes.js';
import { createMemoryIdempotencyStore, FixedClock } from '../../test/support/fakes.js';
import { okEnvelope } from '../envelope.js';
import { sendEnvelope } from '../reply.js';
import { buildServer } from '../server.js';

const START = new Date('2026-10-28T12:00:00.000Z');
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

const itemBody = z.object({ title: z.string().min(1) });
const itemResponse = z.object({
  statusCode: z.number().int(),
  data: z.object({ id: z.string() }),
  timestamp: z.string(),
});

type ActorKind = 'user' | 'public-token' | 'none';

interface Harness {
  readonly app: FastifyInstance;
  readonly store: MemoryIdempotencyStore;
  readonly clock: FixedClock;
  readonly failures: { readonly phase: 'read' | 'write'; readonly error: unknown }[];
  readonly started: Promise<void>;
  release(): void;
  executions(): number;
  close(): Promise<void>;
}

async function buildHarness(actorKind: ActorKind = 'user'): Promise<Harness> {
  const clock = new FixedClock(START);
  const store = createMemoryIdempotencyStore(clock);
  const failures: { phase: 'read' | 'write'; error: unknown }[] = [];
  let executions = 0;
  let markStarted: (() => void) | undefined;
  let release: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const app = await buildServer({
    clock,
    resolveScope: (request: FastifyRequest) => {
      const tenantId = request.headers['x-tenant'];
      if (actorKind === 'none' || typeof tenantId !== 'string' || tenantId === '') {
        return null;
      }
      return buildScope({
        tenantId,
        actor:
          actorKind === 'user'
            ? { kind: 'user', id: 'user-1' }
            : { kind: 'public-token', id: 'tok-1' },
      });
    },
    idempotency: {
      store,
      onStoreFailure: (error, phase) => {
        failures.push({ phase, error });
      },
    },
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/items', { schema: { body: itemBody, response: { 201: itemResponse } } }, async (request, reply) => {
    executions += 1;
    if (request.headers['x-hold'] === 'true') {
      markStarted?.();
      await gate;
    }
    sendEnvelope(reply, { id: `item-${executions}` }, clock, 201);
  });

  typed.post(
    '/items-probe',
    {
      schema: { body: itemBody, response: { 201: itemResponse } },
      config: { connectivityProbe: true },
    },
    async (_request, reply) => {
      executions += 1;
      sendEnvelope(reply, { id: `item-${executions}` }, clock, 201);
    },
  );

  typed.get('/items', async () => {
    executions += 1;
    return okEnvelope({ id: 'x' }, clock);
  });

  typed.post('/items-fail', async () => {
    executions += 1;
    throw new Error('boom');
  });

  return {
    app,
    store,
    clock,
    failures,
    started,
    release: () => {
      release?.();
    },
    executions: () => executions,
    close: () => app.close(),
  };
}

const harnesses: Harness[] = [];

async function harness(actorKind: ActorKind = 'user'): Promise<Harness> {
  const created = await buildHarness(actorKind);
  harnesses.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((current) => current.close()));
});

interface PostOptions {
  readonly key?: string;
  readonly title?: string;
  readonly tenant?: string;
  readonly url?: string;
  readonly hold?: boolean;
  readonly probe?: boolean;
}

function post(app: FastifyInstance, options: PostOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.tenant !== undefined) {
    headers['x-tenant'] = options.tenant;
  }
  if (options.key !== undefined) {
    headers['idempotency-key'] = options.key;
  }
  if (options.hold === true) {
    headers['x-hold'] = 'true';
  }
  if (options.probe === true) {
    headers['x-connectivity-probe'] = 'true';
  }

  return app.inject({
    method: 'POST',
    url: options.url ?? '/items',
    headers,
    payload: { title: options.title ?? 'nota' },
  });
}

describe('precondición de la idempotencia (contrato §1)', () => {
  it('sin Idempotency-Key la request no se protege (se ejecuta siempre)', async () => {
    const current = await harness();

    await post(current.app, { tenant: 't1' });
    await post(current.app, { tenant: 't1' });

    expect(current.executions()).toBe(2);
    expect(current.store.calls.find).toBe(0);
  });

  it('una lectura (GET) no entra al mecanismo', async () => {
    const current = await harness();
    const headers = { 'x-tenant': 't1', 'idempotency-key': 'k1' };

    await current.app.inject({ method: 'GET', url: '/items', headers });
    await current.app.inject({ method: 'GET', url: '/items', headers });

    expect(current.executions()).toBe(2);
    expect(current.store.calls.find).toBe(0);
  });

  it('borde: un token público no es un usuario autenticado → sin protección', async () => {
    const current = await harness('public-token');

    await post(current.app, { tenant: 't1', key: 'k1' });
    await post(current.app, { tenant: 't1', key: 'k1' });

    expect(current.executions()).toBe(2);
    expect(current.store.calls.find).toBe(0);
  });

  it('borde: sin identidad no hay clave de hash → sin protección', async () => {
    const current = await harness('none');

    await post(current.app, { key: 'k1' });
    await post(current.app, { key: 'k1' });

    expect(current.executions()).toBe(2);
  });
});

describe('replay y conflicto (contrato §5/§6/§7)', () => {
  it('replay: misma key + payload devuelve la respuesta almacenada sin re-ejecutar', async () => {
    const current = await harness();

    const first = await post(current.app, { tenant: 't1', key: 'k1' });
    const second = await post(current.app, { tenant: 't1', key: 'k1' });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(current.executions()).toBe(1);
  });

  it('borde: misma key con payload distinto → 409 sin devolver la respuesta ajena', async () => {
    const current = await harness();

    await post(current.app, { tenant: 't1', key: 'k1', title: 'a' });
    const conflict = await post(current.app, { tenant: 't1', key: 'k1', title: 'b' });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
    expect(current.executions()).toBe(1);
  });

  it('borde: la key se recorta de espacios → mismo registro', async () => {
    const current = await harness();

    await post(current.app, { tenant: 't1', key: '  k1  ' });
    await post(current.app, { tenant: 't1', key: 'k1' });

    expect(current.executions()).toBe(1);
  });

  it('borde: el query string no entra en la clave (ruta enrutada, §3)', async () => {
    const current = await harness();

    await post(current.app, { tenant: 't1', key: 'k1', url: '/items?x=1' });
    await post(current.app, { tenant: 't1', key: 'k1', url: '/items?x=2' });

    expect(current.executions()).toBe(1);
  });

  it('concurrencia: una segunda request con la misma key en vuelo → 409', async () => {
    const current = await harness();

    const inFlight = post(current.app, { tenant: 't1', key: 'k1', hold: true });
    await current.started;

    const concurrent = await post(current.app, { tenant: 't1', key: 'k1' });
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json()).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });

    current.release();
    const first = await inFlight;
    expect(first.statusCode).toBe(201);
    expect(current.executions()).toBe(1);
  });
});

describe('fail-open y almacenamiento (contrato §8)', () => {
  it('fail-open: un fallo de lectura del store no bloquea la mutación', async () => {
    const current = await harness();
    current.store.failFind = new Error('store caído');

    const response = await post(current.app, { tenant: 't1', key: 'k1' });

    expect(response.statusCode).toBe(201);
    expect(current.executions()).toBe(1);
    expect(current.failures.map((failure) => failure.phase)).toEqual(['read']);
  });

  it('fail-open: un fallo de escritura responde OK y se registra', async () => {
    const current = await harness();
    current.store.failSave = new Error('store caído');

    const response = await post(current.app, { tenant: 't1', key: 'k1' });

    expect(response.statusCode).toBe(201);
    expect(current.executions()).toBe(1);
    expect(current.failures.map((failure) => failure.phase)).toEqual(['write']);
  });

  it('borde: un 4xx no se almacena (el reintento re-ejecuta)', async () => {
    const current = await harness();

    const invalid = await post(current.app, { tenant: 't1', key: 'k1', title: '' });
    expect(invalid.statusCode).toBe(400);
    expect(current.store.calls.save).toBe(0);

    const retry = await post(current.app, { tenant: 't1', key: 'k1', title: 'ok' });
    expect(retry.statusCode).toBe(201);
    expect(current.executions()).toBe(1);
  });

  it('borde: un 5xx no se almacena (el reintento re-ejecuta)', async () => {
    const current = await harness();

    const first = await post(current.app, { tenant: 't1', key: 'k1', url: '/items-fail' });
    const second = await post(current.app, { tenant: 't1', key: 'k1', url: '/items-fail' });

    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(500);
    expect(current.executions()).toBe(2);
    expect(current.store.calls.save).toBe(0);
  });

  it('borde: vencido el TTL, la misma key vuelve a ejecutar', async () => {
    const current = await harness();

    await post(current.app, { tenant: 't1', key: 'k1' });
    current.clock.advance(FORTY_EIGHT_HOURS + 1);
    const again = await post(current.app, { tenant: 't1', key: 'k1' });

    expect(again.statusCode).toBe(201);
    expect(current.executions()).toBe(2);
  });
});

describe('bypass de probe (contrato §9; ADR 0001 punto 6)', () => {
  it('en un endpoint de probe, X-Connectivity-Probe no toca el store', async () => {
    const current = await harness();

    const response = await post(current.app, {
      tenant: 't1',
      key: 'k1',
      probe: true,
      url: '/items-probe',
    });

    expect(response.statusCode).toBe(201);
    expect(current.store.calls.find).toBe(0);
    expect(current.store.calls.save).toBe(0);
    expect(current.executions()).toBe(1);
  });

  it('borde: el bypass no se honra fuera de un endpoint de probe', async () => {
    const current = await harness();

    await post(current.app, { tenant: 't1', key: 'k1', probe: true, url: '/items' });

    expect(current.store.calls.find).toBe(1);
  });
});