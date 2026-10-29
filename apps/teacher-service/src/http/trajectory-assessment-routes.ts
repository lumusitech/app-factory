import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, resolveVersionConflict, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  COURSE_ID_MAX_LENGTH,
  PERIOD_MAX_LENGTH,
  STUDENT_ID_MAX_LENGTH,
  TRAJECTORY_RATINGS,
  TrajectoryAssessment,
} from '../domain/trajectory-assessment.js';
import type { TeacherRepositories } from './repositories.js';
import { deviceLabel, readBaseVersion } from './sync-headers.js';

/**
 * Rutas de `TrajectoryAssessment` (Valoración preliminar TEA/TEP/TED; F-03, ADR 0013).
 *
 * `PUT /courses/:courseId/trajectory-assessments/:period` reemplaza la hoja de
 * valoraciones del curso en el período **atómica** (§1.3: el ritual es un acto).
 * La mutación resuelve el conflicto de versión bajo `lww` (mono-escritor, T10).
 */

export interface TrajectoryAssessmentRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const params = z.object({
  courseId: z.string().trim().min(1).max(COURSE_ID_MAX_LENGTH),
  period: z.string().trim().min(1).max(PERIOD_MAX_LENGTH),
});

const putBody = z.object({
  entries: z
    .array(
      z.object({
        studentId: z.string().trim().min(1).max(STUDENT_ID_MAX_LENGTH),
        rating: z.enum(TRAJECTORY_RATINGS),
      }),
    )
    .refine(
      (entries) => new Set(entries.map((entry) => entry.studentId)).size === entries.length,
      { message: 'Un alumno no puede aparecer más de una vez en la valoración.' },
    ),
});

const assessmentData = z.object({
  courseId: z.string(),
  period: z.string(),
  entries: z.array(z.object({ studentId: z.string(), rating: z.enum(TRAJECTORY_RATINGS) })),
  version: z.number().int(),
});

const assessmentEnvelope = z.object({
  statusCode: z.number().int(),
  data: assessmentData,
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
  snapshot: ReturnType<TrajectoryAssessment['snapshot']>,
): z.infer<typeof assessmentData> {
  return {
    courseId: snapshot.courseId,
    period: snapshot.period,
    entries: snapshot.entries.map((entry) => ({ studentId: entry.studentId, rating: entry.rating })),
    version: snapshot.version,
  };
}

export function registerTrajectoryAssessmentRoutes(
  app: FastifyInstance,
  deps: TrajectoryAssessmentRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/courses/:courseId/trajectory-assessments/:period',
    { schema: { params, body: putBody, response: { 200: assessmentEnvelope } } },
    async (request, reply) => {
      const scope = requireScope();
      const baseVersion = readBaseVersion(request);
      const { courseId, period } = request.params;

      const { updated, sync } = await deps.uow.run(async (repos) => {
        const existing = await repos.trajectoryAssessments.byCourseAndPeriod(courseId, period);
        const input = {
          tenantId: scope.tenantId,
          courseId,
          period,
          entries: request.body.entries,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        };

        if (existing === null) {
          const created = TrajectoryAssessment.create(input);
          await repos.trajectoryAssessments.save(created);
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
        await repos.trajectoryAssessments.save(next);
        return {
          updated: next,
          sync: resolution.kind === 'lww' ? resolution.signal : undefined,
        };
      });

      sendEnvelope(reply, toResponseData(updated.snapshot()), deps.clock, 200, sync);
    },
  );

  typed.get(
    '/courses/:courseId/trajectory-assessments/:period',
    { schema: { params, response: { 200: assessmentEnvelope } } },
    async (request, reply) => {
      const { courseId, period } = request.params;
      const assessment = await deps.uow.run(async (repos) =>
        repos.trajectoryAssessments.byCourseAndPeriod(courseId, period),
      );
      if (assessment === null) {
        throw new NotFoundError('Valoración no encontrada.');
      }
      sendEnvelope(reply, toResponseData(assessment.snapshot()), deps.clock);
    },
  );
}
