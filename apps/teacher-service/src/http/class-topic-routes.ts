import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, resolveVersionConflict, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ClassTopic, TOPIC_ID_MAX_LENGTH } from '../domain/class-topic.js';
import type { TeacherRepositories } from './repositories.js';
import { deviceLabel, readBaseVersion } from './sync-headers.js';

/**
 * Ruta del tema dictado (vínculo Clase↔Tema; F-01, ADR 0011).
 *
 * `PUT /class-sessions/:id/topic` fija/reemplaza el tema del día. La mutación
 * resuelve el conflicto de versión bajo `lww` (mono-escritor, T10): una escritura
 * obsoleta **se aplica** y devuelve la señal; nunca es silenciosa (sync §8.2).
 */

export interface ClassTopicRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const idParams = z.object({ id: z.string() });

const setBody = z.object({ topicId: z.string().trim().min(1).max(TOPIC_ID_MAX_LENGTH) });

const classTopicData = z.object({
  classSessionId: z.string(),
  topicId: z.string(),
  version: z.number().int(),
});

const classTopicEnvelope = z.object({
  statusCode: z.number().int(),
  data: classTopicData,
  timestamp: z.string(),
  sync: z
    .object({
      previousVersion: z.string(),
      actor: z.string(),
      deviceLabel: z.string(),
      at: z.string(),
    })
    .optional(),
});

function toResponseData(snapshot: ReturnType<ClassTopic['snapshot']>): z.infer<typeof classTopicData> {
  return {
    classSessionId: snapshot.classSessionId,
    topicId: snapshot.topicId,
    version: snapshot.version,
  };
}

export function registerClassTopicRoutes(app: FastifyInstance, deps: ClassTopicRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/class-sessions/:id/topic',
    { schema: { params: idParams, body: setBody, response: { 200: classTopicEnvelope } } },
    async (request, reply) => {
      const scope = requireScope();
      const baseVersion = readBaseVersion(request);

      const { updated, sync } = await deps.uow.run(async (repos) => {
        const session = await repos.classes.byId(request.params.id);
        if (session === null) {
          throw new NotFoundError('Clase no encontrada.');
        }

        const existing = await repos.classTopics.byClassSessionId(request.params.id);
        const input = {
          tenantId: scope.tenantId,
          classSessionId: request.params.id,
          topicId: request.body.topicId,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        };

        if (existing === null) {
          const created = ClassTopic.create(input);
          await repos.classTopics.save(created);
          return { updated: created, sync: undefined };
        }

        const resolution = resolveVersionConflict({
          baseVersion,
          currentVersion: existing.versionToken,
          policy: 'lww',
          actor: scope.actor.id,
          deviceLabel: deviceLabel(request),
          clock: deps.clock,
        });

        const next = existing.setTopic(input);
        await repos.classTopics.save(next);
        return {
          updated: next,
          sync: resolution.kind === 'lww' ? resolution.signal : undefined,
        };
      });

      sendEnvelope(reply, toResponseData(updated.snapshot()), deps.clock, 200, sync);
    },
  );
}
