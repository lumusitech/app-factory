import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { resolveVersionConflict, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  CLOSING_GRADE_MAX,
  CLOSING_GRADE_MIN,
  CLOSING_MOTIVE_MAX_LENGTH,
  COURSE_ID_MAX_LENGTH,
  PERIOD_MAX_LENGTH,
  PeriodClosing,
  STUDENT_ID_MAX_LENGTH,
} from '../domain/period-closing.js';
import { buildPeriodClosing } from '../domain/period-closing-view.js';
import type { TeacherRepositories } from './repositories.js';
import { deviceLabel, readBaseVersion } from './sync-headers.js';

/**
 * Rutas del cierre de período (F-12 parcial; ADR 0016).
 *
 * `PUT /courses/:courseId/period-closings/:period` reemplaza la hoja de
 * **overrides manuales** del curso en el período **atómica** (§1.3: cerrar el curso
 * es un acto). La mutación resuelve el conflicto de versión bajo `lww`
 * (mono-escritor, T10).
 *
 * `GET /courses/:courseId/period-closings/:period` **deriva** la vista del cierre
 * (vista, T6): la nota automática (promedio simple de las notas vigentes del
 * período), la efectiva con su estado y la evolución del registro. Es una
 * **lectura**: no lleva idempotencia ni sync. No calcula la condición
 * (aprobado/intensificación): §7.8/§7.9/T16 lo difieren (ADR 0016).
 */

export interface PeriodClosingRoutesDeps {
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
        value: z.number().int().min(CLOSING_GRADE_MIN).max(CLOSING_GRADE_MAX),
        motive: z.string().trim().max(CLOSING_MOTIVE_MAX_LENGTH).optional(),
      }),
    )
    .refine(
      (entries) => new Set(entries.map((entry) => entry.studentId)).size === entries.length,
      { message: 'Un alumno no puede aparecer más de una vez en el cierre.' },
    ),
});

const closingData = z.object({
  courseId: z.string(),
  period: z.string(),
  entries: z.array(
    z.object({
      studentId: z.string(),
      value: z.number().int(),
      motive: z.string().nullable(),
    }),
  ),
  version: z.number().int(),
});

const closingEnvelope = z.object({
  statusCode: z.number().int(),
  data: closingData,
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

const viewEnvelope = z.object({
  statusCode: z.number().int(),
  data: z.object({
    courseId: z.string(),
    period: z.string(),
    students: z.array(
      z.object({
        studentId: z.string(),
        automatic: z.number().int().nullable(),
        effective: z.number().int().nullable(),
        state: z.enum(['automatica', 'manual']),
        motive: z.string().nullable(),
        evolution: z.array(
          z.object({
            evaluationId: z.string(),
            grade: z.number().int().nullable(),
            note: z.string().nullable(),
            occurredOn: z.string(),
          }),
        ),
      }),
    ),
  }),
  timestamp: z.string(),
});

function toResponseData(
  snapshot: ReturnType<PeriodClosing['snapshot']>,
): z.infer<typeof closingData> {
  return {
    courseId: snapshot.courseId,
    period: snapshot.period,
    entries: snapshot.entries.map((entry) => ({
      studentId: entry.studentId,
      value: entry.value,
      motive: entry.motive,
    })),
    version: snapshot.version,
  };
}

export function registerPeriodClosingRoutes(
  app: FastifyInstance,
  deps: PeriodClosingRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/courses/:courseId/period-closings/:period',
    { schema: { params, body: putBody, response: { 200: closingEnvelope } } },
    async (request, reply) => {
      const scope = requireScope();
      const baseVersion = readBaseVersion(request);
      const { courseId, period } = request.params;

      const { updated, sync } = await deps.uow.run(async (repos) => {
        const existing = await repos.periodClosings.byCourseAndPeriod(courseId, period);
        const input = {
          tenantId: scope.tenantId,
          courseId,
          period,
          entries: request.body.entries,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        };

        if (existing === null) {
          const created = PeriodClosing.create(input);
          await repos.periodClosings.save(created);
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
        await repos.periodClosings.save(next);
        return {
          updated: next,
          sync: resolution.kind === 'lww' ? resolution.signal : undefined,
        };
      });

      sendEnvelope(reply, toResponseData(updated.snapshot()), deps.clock, 200, sync);
    },
  );

  typed.get(
    '/courses/:courseId/period-closings/:period',
    { schema: { params, response: { 200: viewEnvelope } } },
    async (request, reply) => {
      const { courseId, period } = request.params;
      const view = await deps.uow.run(async (repos) => {
        const data = await repos.periodClosingView.byCourseAndPeriod(courseId, period);
        return buildPeriodClosing({ courseId, period, ...data });
      });
      sendEnvelope(reply, view, deps.clock);
    },
  );
}
