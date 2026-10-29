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

import { registerAssignmentRoutes } from './http/assignment-routes.js';
import { registerClassAttendanceRoutes } from './http/class-attendance-routes.js';
import { registerClassSessionRoutes } from './http/class-session-routes.js';
import { registerClassTopicRoutes } from './http/class-topic-routes.js';
import { registerEvaluationRoutes } from './http/evaluation-routes.js';
import { registerGradeSheetRoutes } from './http/grade-sheet-routes.js';
import type { TeacherRepositories } from './http/repositories.js';
import { registerTopicRoutes } from './http/topic-routes.js';
import type { SessionResolver } from './identity.js';
import { PgAssignmentRepository } from './persistence/assignment-repository.js';
import { PgClassAttendanceRepository } from './persistence/class-attendance-repository.js';
import { PgClassSessionRepository } from './persistence/class-session-repository.js';
import { PgClassTopicRepository } from './persistence/class-topic-repository.js';
import { PgEvaluationRepository } from './persistence/evaluation-repository.js';
import { PgGradeSheetRepository } from './persistence/grade-sheet-repository.js';
import { PgTopicRepository } from './persistence/topic-repository.js';

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
 * resolver de alcance y el store de idempotencia, la unidad de trabajo con los
 * puertos por agregado (F-01: clase, tema, tema dictado, tarea y asistencia) y
 * las rutas de la vertical.
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

  const uow = new PgUnitOfWork<TeacherRepositories>(deps.connection, (context) => ({
    classes: new PgClassSessionRepository(context, new PgOutboxPort(context)),
    topics: new PgTopicRepository(context, new PgOutboxPort(context)),
    classTopics: new PgClassTopicRepository(context, new PgOutboxPort(context)),
    assignments: new PgAssignmentRepository(context, new PgOutboxPort(context)),
    attendances: new PgClassAttendanceRepository(context, new PgOutboxPort(context)),
    evaluations: new PgEvaluationRepository(context, new PgOutboxPort(context)),
    gradeSheets: new PgGradeSheetRepository(context, new PgOutboxPort(context)),
  }));

  registerProbeRoute(app, deps.clock);
  registerClassSessionRoutes(app, { uow, clock: deps.clock, idGenerator });
  registerTopicRoutes(app, { uow, clock: deps.clock, idGenerator });
  registerClassTopicRoutes(app, { uow, clock: deps.clock, idGenerator });
  registerAssignmentRoutes(app, { uow, clock: deps.clock, idGenerator });
  registerClassAttendanceRoutes(app, { uow, clock: deps.clock, idGenerator });
  registerEvaluationRoutes(app, { uow, clock: deps.clock, idGenerator });
  registerGradeSheetRoutes(app, { uow, clock: deps.clock, idGenerator });

  return app;
}
