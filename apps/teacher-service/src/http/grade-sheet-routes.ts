import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { NotFoundError, resolveVersionConflict, sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { GRADE_MAX, GRADE_MIN, GradeSheet, STUDENT_ID_MAX_LENGTH } from '../domain/grade-sheet.js';
import type { TeacherRepositories } from './repositories.js';
import { deviceLabel, readBaseVersion } from './sync-headers.js';

/**
 * Rutas de `GradeSheet` (Notas; F-02, ADR 0012).
 *
 * `PUT /evaluations/:id/grades` reemplaza la hoja de notas de la evaluación
 * **atómica** (§1.3: cargar 30 notas es un acto). La mutación resuelve el
 * conflicto de versión bajo `lww` (mono-escritor, T10).
 */

export interface GradeSheetRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const idParams = z.object({ id: z.string() });

const gradeBody = z.object({
  entries: z
    .array(
      z.object({
        studentId: z.string().trim().min(1).max(STUDENT_ID_MAX_LENGTH),
        value: z.number().int().min(GRADE_MIN).max(GRADE_MAX),
      }),
    )
    .refine(
      (entries) => new Set(entries.map((entry) => entry.studentId)).size === entries.length,
      { message: 'Un alumno no puede aparecer más de una vez en las notas.' },
    ),
});

const gradeData = z.object({
  evaluationId: z.string(),
  entries: z.array(z.object({ studentId: z.string(), value: z.number().int() })),
  version: z.number().int(),
});

const gradeEnvelope = z.object({
  statusCode: z.number().int(),
  data: gradeData,
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

function toResponseData(snapshot: ReturnType<GradeSheet['snapshot']>): z.infer<typeof gradeData> {
  return {
    evaluationId: snapshot.evaluationId,
    entries: snapshot.entries.map((entry) => ({ studentId: entry.studentId, value: entry.value })),
    version: snapshot.version,
  };
}

export function registerGradeSheetRoutes(app: FastifyInstance, deps: GradeSheetRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/evaluations/:id/grades',
    { schema: { params: idParams, body: gradeBody, response: { 200: gradeEnvelope } } },
    async (request, reply) => {
      const scope = requireScope();
      const baseVersion = readBaseVersion(request);

      const { updated, sync } = await deps.uow.run(async (repos) => {
        const evaluation = await repos.evaluations.byId(request.params.id);
        if (evaluation === null) {
          throw new NotFoundError('Evaluación no encontrada.');
        }

        const existing = await repos.gradeSheets.byEvaluationId(request.params.id);
        const input = {
          tenantId: scope.tenantId,
          evaluationId: request.params.id,
          entries: request.body.entries,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        };

        if (existing === null) {
          const created = GradeSheet.create(input);
          await repos.gradeSheets.save(created);
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
        await repos.gradeSheets.save(next);
        return {
          updated: next,
          sync: resolution.kind === 'lww' ? resolution.signal : undefined,
        };
      });

      sendEnvelope(reply, toResponseData(updated.snapshot()), deps.clock, 200, sync);
    },
  );

  typed.get(
    '/evaluations/:id/grades',
    { schema: { params: idParams, response: { 200: gradeEnvelope } } },
    async (request, reply) => {
      const sheet = await deps.uow.run(async (repos) => {
        const evaluation = await repos.evaluations.byId(request.params.id);
        if (evaluation === null) {
          throw new NotFoundError('Evaluación no encontrada.');
        }
        return repos.gradeSheets.byEvaluationId(request.params.id);
      });
      if (sheet === null) {
        throw new NotFoundError('Notas no encontradas.');
      }
      sendEnvelope(reply, toResponseData(sheet.snapshot()), deps.clock);
    },
  );
}
