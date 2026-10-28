import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../test/support/fakes.js';
import { registerProbeRoute } from './routes/probe.js';
import { buildServer } from './server.js';

interface OpenApiDoc {
  readonly paths?: Record<
    string,
    | {
        readonly get?: {
          readonly responses?: Record<
            string,
            {
              readonly content?: Record<
                string,
                { readonly schema?: { readonly properties?: Record<string, unknown> } }
              >;
            }
          >;
        };
      }
    | undefined
  >;
}

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildServer({
    clock: CLOCK,
    resolveScope: null,
    openapi: { title: 'kernel-test', version: '0.1.0' },
  });
  registerProbeRoute(app, CLOCK);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('pipeline Zod → JSON Schema → OpenAPI (D4)', () => {
  it('publica la ruta en el documento OpenAPI con un schema derivado de Zod', () => {
    const doc = app.swagger() as unknown as OpenApiDoc;
    const probe = doc.paths?.['/probe']?.get;

    expect(probe).toBeDefined();

    const schema = probe?.responses?.['200']?.content?.['application/json']?.schema;
    expect(Object.keys(schema?.properties ?? {})).toEqual(
      expect.arrayContaining(['statusCode', 'data', 'timestamp']),
    );
  });

  it('la ruta /probe responde el envelope sin necesitar alcance (scope.md §1)', async () => {
    const response = await app.inject({ method: 'GET', url: '/probe' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      statusCode: 200,
      data: { status: 'ok' },
      timestamp: '2026-10-28T12:00:00.000Z',
    });
  });
});