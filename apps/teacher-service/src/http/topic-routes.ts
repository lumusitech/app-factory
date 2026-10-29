import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  COURSE_ID_MAX_LENGTH,
  TOPIC_CONTENT_MAX_LENGTH,
  TOPIC_ID_MAX_LENGTH,
  TOPIC_ORDER_MAX,
  TOPIC_ORDER_MIN,
  Topic,
} from '../domain/topic.js';
import type { TeacherRepositories } from './repositories.js';

/**
 * Rutas de `Topic` (Tema del plan; F-01, ADR 0011).
 *
 * `POST /courses/:courseId/topics` crea un tema del plan. El `id` es **opcional**:
 * el cliente puede aportarlo (UUIDv7, D8) para crear y vincular un tema en la
 * misma sesión offline (ADR 0011).
 */

export interface TopicRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const courseParams = z.object({ courseId: z.string().trim().min(1).max(COURSE_ID_MAX_LENGTH) });

const createBody = z.object({
  id: z.string().trim().min(1).max(TOPIC_ID_MAX_LENGTH).optional(),
  order: z.number().int().min(TOPIC_ORDER_MIN).max(TOPIC_ORDER_MAX),
  content: z.string().trim().min(1).max(TOPIC_CONTENT_MAX_LENGTH),
});

const topicData = z.object({
  id: z.string(),
  courseId: z.string(),
  order: z.number().int(),
  content: z.string(),
  version: z.number().int(),
});

const topicEnvelope = z.object({
  statusCode: z.number().int(),
  data: topicData,
  timestamp: z.string(),
});

function toResponseData(snapshot: ReturnType<Topic['snapshot']>): z.infer<typeof topicData> {
  return {
    id: snapshot.id,
    courseId: snapshot.courseId,
    order: snapshot.order,
    content: snapshot.content,
    version: snapshot.version,
  };
}

export function registerTopicRoutes(app: FastifyInstance, deps: TopicRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/courses/:courseId/topics',
    { schema: { params: courseParams, body: createBody, response: { 201: topicEnvelope } } },
    async (request, reply) => {
      const tenantId = requireScope().tenantId;

      const created = await deps.uow.run(async (repos) => {
        const topic = Topic.create({
          tenantId,
          courseId: request.params.courseId,
          order: request.body.order,
          content: request.body.content,
          ...(request.body.id === undefined ? {} : { id: request.body.id }),
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        await repos.topics.save(topic);
        return topic;
      });

      sendEnvelope(reply, toResponseData(created.snapshot()), deps.clock, 201);
    },
  );
}
