import { HEADERS } from '@kernel/contracts';
import type { OverwriteSignal } from '@kernel/contracts';
import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, resolveVersionConflict, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { CLASS_STATUSES, ClassSession, isValidCalendarDate } from '../domain/class-session.js';
import type { ClassSessionRepository } from '../domain/class-session-repository.js';

/**
 * Rutas de `ClassSession` (F-01, corte de servidor; ADR 0010).
 *
 * Toda mutación resuelve el conflicto de versión bajo la política `lww`
 * (mono-escritor, T10): una escritura obsoleta **se aplica** y devuelve la señal
 * de sobrescritura; nunca es silenciosa (sync §8.2).
 */

export interface ClassSessionRepositories {
  readonly classes: ClassSessionRepository;
}

export interface ClassSessionRoutesDeps {
  readonly uow: UnitOfWork<ClassSessionRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const calendarDate = z
  .string()
  .refine(isValidCalendarDate, 'Fecha de calendario inválida (YYYY-MM-DD).');

const createBody = z.object({
  courseId: z.string().trim().min(1).max(200),
  date: calendarDate,
});

const transitionBody = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('cancelada'),
    cancellationReason: z.string().trim().min(1).max(200),
  }),
  z.object({ status: z.literal('feriado') }),
  z.object({ status: z.literal('sin_clase') }),
]);

const sessionData = z.object({
  id: z.string(),
  courseId: z.string(),
  date: z.string(),
  status: z.enum(CLASS_STATUSES),
  cancellationReason: z.string().nullable(),
  version: z.number().int(),
});

const overwriteSignal = z.object({
  previousVersion: z.string(),
  actor: z.string(),
  deviceLabel: z.string(),
  at: z.string(),
});

const sessionEnvelope = z.object({
  statusCode: z.number().int(),
  data: sessionData,
  timestamp: z.string(),
});

const transitionEnvelope = z.object({
  statusCode: z.number().int(),
  data: sessionData,
  timestamp: z.string(),
  sync: overwriteSignal.optional(),
});

const idParams = z.object({ id: z.string() });

function toResponseData(snapshot: ReturnType<ClassSession['snapshot']>): z.infer<typeof sessionData> {
  return {
    id: snapshot.id,
    courseId: snapshot.courseId,
    date: snapshot.date,
    status: snapshot.status,
    cancellationReason: snapshot.cancellationReason,
    version: snapshot.version,
  };
}

/** Lee el token de versión del header (`X-Sync-Base-Version`), o `null`. */
function readBaseVersion(request: FastifyRequest): string | null {
  const raw = request.headers[HEADERS.syncBaseVersion.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Etiqueta legible de dispositivo, **derivada por el servidor** (sync §8.2). */
function deviceLabel(request: FastifyRequest): string {
  const raw = request.headers['user-agent'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value.slice(0, 120) : 'desconocido';
}

function applyTransition(
  session: ClassSession,
  body: z.infer<typeof transitionBody>,
  deps: ClassSessionRoutesDeps,
): ClassSession {
  const input = { clock: deps.clock, idGenerator: deps.idGenerator };
  switch (body.status) {
    case 'cancelada':
      return session.cancel({ reason: body.cancellationReason, ...input });
    case 'feriado':
      return session.markHoliday(input);
    case 'sin_clase':
      return session.markNoClass(input);
  }
}

export function registerClassSessionRoutes(
  app: FastifyInstance,
  deps: ClassSessionRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/class-sessions',
    { schema: { body: createBody, response: { 201: sessionEnvelope } } },
    async (request, reply) => {
      const tenantId = requireScope().tenantId;

      const created = await deps.uow.run(async (repos) => {
        const session = ClassSession.create({
          tenantId,
          courseId: request.body.courseId,
          date: request.body.date,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        await repos.classes.save(session);
        return session;
      });

      sendEnvelope(reply, toResponseData(created.snapshot()), deps.clock, 201);
    },
  );

  typed.get(
    '/class-sessions/:id',
    { schema: { params: idParams, response: { 200: sessionEnvelope } } },
    async (request, reply) => {
      const session = await deps.uow.run(async (repos) => repos.classes.byId(request.params.id));
      if (session === null) {
        throw new NotFoundError('Clase no encontrada.');
      }
      sendEnvelope(reply, toResponseData(session.snapshot()), deps.clock);
    },
  );

  typed.patch(
    '/class-sessions/:id',
    { schema: { params: idParams, body: transitionBody, response: { 200: transitionEnvelope } } },
    async (request, reply) => {
      const scope = requireScope();
      const baseVersion = readBaseVersion(request);

      const { updated, resolution } = await deps.uow.run(async (repos) => {
        const session = await repos.classes.byId(request.params.id);
        if (session === null) {
          throw new NotFoundError('Clase no encontrada.');
        }

        const resolved = resolveVersionConflict({
          baseVersion,
          currentVersion: session.versionToken,
          policy: 'lww',
          actor: scope.actor.id,
          deviceLabel: deviceLabel(request),
          clock: deps.clock,
        });

        const next = applyTransition(session, request.body, deps);
        await repos.classes.save(next);
        return { updated: next, resolution: resolved };
      });

      const sync: OverwriteSignal | undefined =
        resolution.kind === 'lww' ? resolution.signal : undefined;
      sendEnvelope(reply, toResponseData(updated.snapshot()), deps.clock, 200, sync);
    },
  );
}
