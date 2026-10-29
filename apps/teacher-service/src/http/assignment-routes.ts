import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  ASSIGNMENT_CONTENT_MAX_LENGTH,
  Assignment,
  TOPIC_ID_MAX_LENGTH,
} from '../domain/assignment.js';
import type { TeacherRepositories } from './repositories.js';

/**
 * Ruta de `Assignment` (Tarea = consigna del día; F-01, ADR 0011).
 *
 * `POST /class-sessions/:id/assignments` crea una tarea de la clase (puede haber
 * varias). `topicId` es **opcional**: la tarea puede referir el tema del plan.
 */

export interface AssignmentRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const idParams = z.object({ id: z.string() });

const createBody = z.object({
  content: z.string().trim().min(1).max(ASSIGNMENT_CONTENT_MAX_LENGTH),
  topicId: z.string().trim().min(1).max(TOPIC_ID_MAX_LENGTH).optional(),
});

const assignmentData = z.object({
  id: z.string(),
  classSessionId: z.string(),
  topicId: z.string().nullable(),
  content: z.string(),
  version: z.number().int(),
});

const assignmentEnvelope = z.object({
  statusCode: z.number().int(),
  data: assignmentData,
  timestamp: z.string(),
});

function toResponseData(
  snapshot: ReturnType<Assignment['snapshot']>,
): z.infer<typeof assignmentData> {
  return {
    id: snapshot.id,
    classSessionId: snapshot.classSessionId,
    topicId: snapshot.topicId,
    content: snapshot.content,
    version: snapshot.version,
  };
}

export function registerAssignmentRoutes(app: FastifyInstance, deps: AssignmentRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/class-sessions/:id/assignments',
    { schema: { params: idParams, body: createBody, response: { 201: assignmentEnvelope } } },
    async (request, reply) => {
      const tenantId = requireScope().tenantId;

      const created = await deps.uow.run(async (repos) => {
        const session = await repos.classes.byId(request.params.id);
        if (session === null) {
          throw new NotFoundError('Clase no encontrada.');
        }

        const assignment = Assignment.create({
          tenantId,
          classSessionId: request.params.id,
          content: request.body.content,
          ...(request.body.topicId === undefined ? {} : { topicId: request.body.topicId }),
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        await repos.assignments.save(assignment);
        return assignment;
      });

      sendEnvelope(reply, toResponseData(created.snapshot()), deps.clock, 201);
    },
  );
}
