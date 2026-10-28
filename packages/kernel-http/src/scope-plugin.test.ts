import { buildScope, getScope, requireScope } from '@kernel/scope';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../test/support/fakes.js';
import { okEnvelope } from './envelope.js';
import { buildServer } from './server.js';

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));

let app: FastifyInstance;

function registerRoutes(target: FastifyInstance): void {
  target.get('/whoami', async () => okEnvelope({ tenantId: requireScope().tenantId }, CLOCK));
  target.get('/async', async () => {
    await Promise.resolve();
    return okEnvelope({ tenantId: requireScope().tenantId }, CLOCK);
  });
  target.get('/scope-state', async () => okEnvelope({ hasScope: getScope() !== undefined }, CLOCK));
}

function resolverFor(request: FastifyRequest) {
  const tenantId = request.headers['x-tenant'];
  if (typeof tenantId !== 'string' || tenantId === '') {
    return null;
  }
  return buildScope({ tenantId, actor: { kind: 'user', id: 'user-1' } });
}

beforeEach(async () => {
  app = await buildServer({ clock: CLOCK, resolveScope: resolverFor });
  registerRoutes(app);
});

afterEach(async () => {
  await app.close();
});

describe('middleware de alcance (scope.md §4)', () => {
  it('puebla el alcance y el handler lo ve', async () => {
    const response = await app.inject({ method: 'GET', url: '/whoami', headers: { 'x-tenant': 't1' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { tenantId: 't1' } });
  });

  it('propaga el alcance a través de awaits del handler', async () => {
    const response = await app.inject({ method: 'GET', url: '/async', headers: { 'x-tenant': 't1' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { tenantId: 't1' } });
  });

  it('borde: sin identidad no puebla alcance y el repositorio falla cerrado', async () => {
    const missing = await app.inject({ method: 'GET', url: '/whoami' });
    expect(missing.statusCode).toBe(500);
    expect(missing.json()).toMatchObject({ error: 'SCOPE_MISSING' });

    const state = await app.inject({ method: 'GET', url: '/scope-state' });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ data: { hasScope: false } });
  });

  it('borde: dos requests concurrentes no comparten alcance', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/async', headers: { 'x-tenant': 'tenant-a' } }),
      app.inject({ method: 'GET', url: '/async', headers: { 'x-tenant': 'tenant-b' } }),
    ]);

    expect(a.json()).toMatchObject({ data: { tenantId: 'tenant-a' } });
    expect(b.json()).toMatchObject({ data: { tenantId: 'tenant-b' } });
  });
});

describe('middleware de alcance (bordes de resolución)', () => {
  it('un resolver que lanza → 500 INTERNAL_ERROR', async () => {
    const failing = await buildServer({
      clock: CLOCK,
      resolveScope: () => {
        throw new Error('auth caída');
      },
    });
    failing.get('/whoami', async () => okEnvelope({ tenantId: requireScope().tenantId }, CLOCK));

    const response = await failing.inject({ method: 'GET', url: '/whoami' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
    await failing.close();
  });

  it('sin resolver (resolveScope null) no hay alcance en ningún handler', async () => {
    const bare = await buildServer({ clock: CLOCK, resolveScope: null });
    bare.get('/scope-state', async () => okEnvelope({ hasScope: getScope() !== undefined }, CLOCK));

    const response = await bare.inject({ method: 'GET', url: '/scope-state' });

    expect(response.json()).toMatchObject({ data: { hasScope: false } });
    await bare.close();
  });
});