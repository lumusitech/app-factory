import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  COURSE_ID_MAX_LENGTH,
  EVALUATION_ID_MAX_LENGTH,
  EVALUATION_NAME_MAX_LENGTH,
  EVALUATION_PERIOD_MAX_LENGTH,
  Evaluation,
} from '../domain/evaluation.js';
import type { TeacherRepositories } from './repositories.js';

/**
 * Rutas de `Evaluation` (Evaluación; F-02, ADR 0012).
 *
 * `POST /courses/:courseId/evaluations` crea una evaluación. El `id` es
 * **opcional**: el cliente puede aportarlo (UUIDv7, D8) para crear la evaluación
 * y cargar sus notas en la misma sesión offline.
 */

export interface EvaluationRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const courseParams = z.object({ courseId: z.string().trim().min(1).max(COURSE_ID_MAX_LENGTH) });

const createBody = z.object({
  id: z.string().trim().min(1).max(EVALUATION_ID_MAX_LENGTH).optional(),
  name: z.string().trim().min(1).max(EVALUATION_NAME_MAX_LENGTH),
  period: z.string().trim().min(1).max(EVALUATION_PERIOD_MAX_LENGTH),
  weight: z.number().positive().finite(),
});

const evaluationData = z.object({
  id: z.string(),
  courseId: z.string(),
  name: z.string(),
  period: z.string(),
  weight: z.number(),
  version: z.number().int(),
});

const evaluationEnvelope = z.object({
  statusCode: z.number().int(),
  data: evaluationData,
  timestamp: z.string(),
});

const idParams = z.object({ id: z.string() });

function toResponseData(snapshot: ReturnType<Evaluation['snapshot']>): z.infer<typeof evaluationData> {
  return {
    id: snapshot.id,
    courseId: snapshot.courseId,
    name: snapshot.name,
    period: snapshot.period,
    weight: snapshot.weight,
    version: snapshot.version,
  };
}

export function registerEvaluationRoutes(
  app: FastifyInstance,
  deps: EvaluationRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/courses/:courseId/evaluations',
    { schema: { params: courseParams, body: createBody, response: { 201: evaluationEnvelope } } },
    async (request, reply) => {
      const tenantId = requireScope().tenantId;

      const created = await deps.uow.run(async (repos) => {
        const evaluation = Evaluation.create({
          tenantId,
          courseId: request.params.courseId,
          name: request.body.name,
          period: request.body.period,
          weight: request.body.weight,
          ...(request.body.id === undefined ? {} : { id: request.body.id }),
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        await repos.evaluations.save(evaluation);
        return evaluation;
      });

      sendEnvelope(reply, toResponseData(created.snapshot()), deps.clock, 201);
    },
  );

  typed.get(
    '/evaluations/:id',
    { schema: { params: idParams, response: { 200: evaluationEnvelope } } },
    async (request, reply) => {
      const evaluation = await deps.uow.run(async (repos) => repos.evaluations.byId(request.params.id));
      if (evaluation === null) {
        throw new NotFoundError('Evaluación no encontrada.');
      }
      sendEnvelope(reply, toResponseData(evaluation.snapshot()), deps.clock);
    },
  );
}
