import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { FixedClock } from '../test/support/fakes.js';
import { sendEnvelope } from './reply.js';
import { buildServer } from './server.js';

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildServer({ clock: CLOCK, resolveScope: null });

  app.withTypeProvider<ZodTypeProvider>().post(
    '/items',
    {
      schema: {
        response: {
          201: z.object({
            statusCode: z.number().int(),
            data: z.object({ id: z.string() }),
            timestamp: z.string(),
          }),
        },
      },
    },
    async (_request, reply) => {
      sendEnvelope(reply, { id: 'n1' }, CLOCK, 201);
    },
  );
});

afterEach(async () => {
  await app.close();
});

describe('sendEnvelope', () => {
  it('fija el status HTTP y el del envelope con el mismo valor', async () => {
    const response = await app.inject({ method: 'POST', url: '/items' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      statusCode: 201,
      data: { id: 'n1' },
      timestamp: '2026-10-28T12:00:00.000Z',
    });
  });
});