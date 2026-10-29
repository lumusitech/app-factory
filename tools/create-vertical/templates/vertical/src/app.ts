import type { Clock } from '@kernel/domain';
import { buildServer, registerProbeRoute } from '@kernel/http';
import type { SqlConnection } from '@kernel/persistence';
import { PgIdempotencyStore } from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';

import type { SessionResolver } from './identity.js';

export interface AppDependencies {
  /** Conexión SQL (Postgres en producción; PGlite en tests; D4). */
  readonly connection: SqlConnection;
  readonly clock: Clock;
  /** Resolver de identidad → alcance (`SessionResolver` placeholder). */
  readonly resolver: SessionResolver;
  readonly logger?: boolean;
}

/**
 * Composition root manual del borde (D4). Arma `@kernel/http` con el reloj, el
 * resolver de alcance y el store de idempotencia, y registra el probe. Las rutas
 * de **dominio** se registran acá abajo, sobre `app`.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = await buildServer({
    clock: deps.clock,
    resolveScope: deps.resolver,
    idempotency: { store: new PgIdempotencyStore(deps.connection, deps.clock) },
    openapi: { title: '@app/{{NAME}}', version: '0.1.0' },
    logger: deps.logger ?? false,
  });

  registerProbeRoute(app, deps.clock);

  // Rutas de dominio de la vertical:
  // app.get('/recurso', { ... }, async (request, reply) => { ... });

  return app;
}
