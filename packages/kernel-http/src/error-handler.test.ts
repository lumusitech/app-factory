import { ScopeMissingError } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FixedClock } from '../test/support/fakes.js';
import { okEnvelope } from './envelope.js';
import { HttpError } from './errors.js';
import { sendEnvelope } from './reply.js';
import { buildServer } from './server.js';

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildServer({ clock: CLOCK, resolveScope: null });

  app.get('/ok', async () => okEnvelope({ fine: true }, CLOCK));

  app.get('/http-error', async () => {
    throw new HttpError('UNAUTHORIZED', 'Sin credenciales.');
  });

  app.get('/scope-missing', async () => {
    throw new ScopeMissingError();
  });

  app.get('/boom', async () => {
    throw new Error('detalle interno secreto');
  });

  app.withTypeProvider<ZodTypeProvider>().post(
    '/validated',
    { schema: { body: z.object({ title: z.string().min(1) }) } },
    async (_request, reply) => {
      sendEnvelope(reply, { ok: true }, CLOCK, 201);
    },
  );
});

afterEach(async () => {
  await app.close();
});

describe('filtro de errores (envelope + catálogo de códigos)', () => {
  it('ruta desconocida → 404 NOT_FOUND', async () => {
    const response = await app.inject({ method: 'GET', url: '/no-existe' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      statusCode: 404,
      message: 'Ruta no encontrada: GET /no-existe',
      error: 'NOT_FOUND',
      timestamp: '2026-10-28T12:00:00.000Z',
    });
  });

  it('HttpError → su código y status del catálogo', async () => {
    const response = await app.inject({ method: 'GET', url: '/http-error' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'UNAUTHORIZED', statusCode: 401 });
  });

  it('borde: ScopeMissingError → 500 SCOPE_MISSING', async () => {
    const response = await app.inject({ method: 'GET', url: '/scope-missing' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('borde: cuerpo inválido → 400 VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: { title: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('borde: error desconocido → 500 INTERNAL_ERROR sin filtrar detalles', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('secreto');
  });

  it('la respuesta exitosa respeta el envelope con el Clock inyectado', async () => {
    const response = await app.inject({ method: 'GET', url: '/ok' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      statusCode: 200,
      data: { fine: true },
      timestamp: '2026-10-28T12:00:00.000Z',
    });
  });
});