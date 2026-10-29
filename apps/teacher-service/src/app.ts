import type { Clock, IdGenerator } from '@kernel/domain';
import { buildServer, registerProbeRoute } from '@kernel/http';
import type { SqlConnection } from '@kernel/persistence';
import {
  PgIdempotencyStore,
  PgOutboxPort,
  PgUnitOfWork,
  UuidV7Generator,
} from '@kernel/persistence';
import type { FastifyInstance } from 'fastify';

import { registerClassSessionRoutes } from './http/class-session-routes.js';
import type { ClassSessionRepositories } from './http/class-session-routes.js';
import type { SessionResolver } from './identity.js';
import { PgClassSessionRepository } from './persistence/class-session-repository.js';

export interface AppDependencies {
  /** Conexión SQL (Postgres en producción; PGlite en tests; D4). */
  readonly connection: SqlConnection;
  readonly clock: Clock;
  /** Resolver de identidad → alcance (`SessionResolver` placeholder). */
  readonly resolver: SessionResolver;
  /** Generador de IDs del dominio (UUIDv7, D8). Por defecto, `UuidV7Generator`. */
  readonly idGenerator?: IdGenerator;
  readonly logger?: boolean;
}

/**
 * Composition root manual del borde (D4). Arma `@kernel/http` con el reloj, el
 * resolver de alcance y el store de idempotencia, la unidad de trabajo con el
 * puerto por agregado y las rutas de `ClassSession`.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const idGenerator = deps.idGenerator ?? new UuidV7Generator();

  const app = await buildServer({
    clock: deps.clock,
    resolveScope: deps.resolver,
    idempotency: { store: new PgIdempotencyStore(deps.connection, deps.clock) },
    openapi: { title: '@app/teacher-service', version: '0.1.0' },
    logger: deps.logger ?? false,
  });

  const uow = new PgUnitOfWork<ClassSessionRepositories>(deps.connection, (context) => ({
    classes: new PgClassSessionRepository(context, new PgOutboxPort(context)),
  }));

  registerProbeRoute(app, deps.clock);
  registerClassSessionRoutes(app, { uow, clock: deps.clock, idGenerator });

  return app;
}
