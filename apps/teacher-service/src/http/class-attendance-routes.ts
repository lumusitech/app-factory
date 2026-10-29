import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, resolveVersionConflict, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  ATTENDANCE_STATUSES,
  ClassAttendance,
  STUDENT_ID_MAX_LENGTH,
} from '../domain/class-attendance.js';
import type { TeacherRepositories } from './repositories.js';
import { deviceLabel, readBaseVersion } from './sync-headers.js';

/**
 * Ruta de `ClassAttendance` (Asistencia; F-01, ADR 0011).
 *
 * `PUT /class-sessions/:id/attendance` reemplaza la hoja de asistencia de la
 * clase **atómica** (§1.3: el ritual es un acto). La mutación resuelve el
 * conflicto de versión bajo `lww` (mono-escritor, T10).
 */

export interface ClassAttendanceRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const idParams = z.object({ id: z.string() });

const attendanceBody = z.object({
  entries: z
    .array(
      z.object({
        studentId: z.string().trim().min(1).max(STUDENT_ID_MAX_LENGTH),
        status: z.enum(ATTENDANCE_STATUSES),
      }),
    )
    .refine(
      (entries) => new Set(entries.map((entry) => entry.studentId)).size === entries.length,
      { message: 'Un alumno no puede aparecer más de una vez en la asistencia.' },
    ),
});

const attendanceData = z.object({
  classSessionId: z.string(),
  entries: z.array(z.object({ studentId: z.string(), status: z.enum(ATTENDANCE_STATUSES) })),
  version: z.number().int(),
});

const attendanceEnvelope = z.object({
  statusCode: z.number().int(),
  data: attendanceData,
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

function toResponseData(
  snapshot: ReturnType<ClassAttendance['snapshot']>,
): z.infer<typeof attendanceData> {
  return {
    classSessionId: snapshot.classSessionId,
    entries: snapshot.entries.map((entry) => ({ studentId: entry.studentId, status: entry.status })),
    version: snapshot.version,
  };
}

export function registerClassAttendanceRoutes(
  app: FastifyInstance,
  deps: ClassAttendanceRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/class-sessions/:id/attendance',
    { schema: { params: idParams, body: attendanceBody, response: { 200: attendanceEnvelope } } },
    async (request, reply) => {
      const scope = requireScope();
      const baseVersion = readBaseVersion(request);

      const { updated, sync } = await deps.uow.run(async (repos) => {
        const session = await repos.classes.byId(request.params.id);
        if (session === null) {
          throw new NotFoundError('Clase no encontrada.');
        }

        const existing = await repos.attendances.byClassSessionId(request.params.id);
        const input = {
          tenantId: scope.tenantId,
          classSessionId: request.params.id,
          entries: request.body.entries,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        };

        if (existing === null) {
          const created = ClassAttendance.create(input);
          await repos.attendances.save(created);
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

        const next = existing.replace(input);
        await repos.attendances.save(next);
        return {
          updated: next,
          sync: resolution.kind === 'lww' ? resolution.signal : undefined,
        };
      });

      sendEnvelope(reply, toResponseData(updated.snapshot()), deps.clock, 200, sync);
    },
  );
}
