import type { Clock } from '@kernel/domain';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { okEnvelope } from '../envelope.js';

const probeResponse = z.object({
  statusCode: z.number().int(),
  data: z.object({ status: z.literal('ok') }),
  timestamp: z.string(),
});

/**
 * Endpoint **sin datos de tenant**: no puebla ni consume alcance (scope.md §1,
 * §10). Es el caso que prueba que el kernel no exige alcance para todo, y declara
 * el bypass `X-Connectivity-Probe` (ADR 0001 punto 6).
 */
export function registerProbeRoute(app: FastifyInstance, clock: Clock): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/probe',
    {
      schema: { response: { 200: probeResponse } },
      config: { connectivityProbe: true },
    },
    async () => okEnvelope({ status: 'ok' as const }, clock),
  );
}