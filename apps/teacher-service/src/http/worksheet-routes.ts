import type { ConfigSchemaRegistry } from '@kernel/config';
import { ConfigService } from '@kernel/config';
import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { renderDailyWorksheetPdf } from '../documents/worksheet-pdf-renderer.js';
import { resolveWorksheetTemplate } from '../documents/worksheet-template-catalog.js';
import { isValidCalendarDate } from '../domain/class-session.js';
import { buildDailyWorksheet } from '../domain/daily-worksheet.js';
import { COURSE_ID_MAX_LENGTH } from '../domain/evaluation.js';
import { PERIOD_MAX_LENGTH, STUDENT_ID_MAX_LENGTH } from '../domain/period-closing.js';
import { buildContext, contextQuery } from './context-query.js';
import type { TeacherRepositories } from './repositories.js';

/**
 * Rutas de la planilla de uso diario (ADR 0017).
 *
 * - `GET /courses/:courseId/worksheet.pdf` → **matriz** (planilla entera).
 * - `GET /courses/:courseId/students/:studentId/worksheet.pdf` → **bloque**
 *   (seguimiento de un estudiante).
 *
 * Ambas **derivan** la hoja (vista, T6) y la renderizan a **PDF** en el
 * **servidor**. Son **lecturas**: sin idempotencia ni sync, y respuesta binaria
 * (`application/pdf`), **fuera** del envelope JSON del kernel. El `period` y el
 * rango `from`/`to` son **opacos** (sin fechas hardcodeadas, §7.8); la cabecera
 * (escuela, materia, división, ciclo, docente) viaja por **query params opacos**
 * que la plantilla mapea (`context.*`). No se calcula la **condición**
 * (aprobado/intensificación): §7.8/§7.9/T16 lo difieren (ADR 0016 punto 8).
 */

export interface WorksheetRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly configRegistry: ConfigSchemaRegistry;
}

const zCalendarDate = z
  .string()
  .trim()
  .refine(isValidCalendarDate, { message: 'Fecha de calendario inválida (AAAA-MM-DD).' });

const courseParams = z.object({
  courseId: z.string().trim().min(1).max(COURSE_ID_MAX_LENGTH),
});

const studentParams = z.object({
  courseId: z.string().trim().min(1).max(COURSE_ID_MAX_LENGTH),
  studentId: z.string().trim().min(1).max(STUDENT_ID_MAX_LENGTH),
});

const query = contextQuery.extend({
  period: z.string().trim().min(1).max(PERIOD_MAX_LENGTH),
  from: zCalendarDate.optional(),
  to: zCalendarDate.optional(),
});

export function registerWorksheetRoutes(app: FastifyInstance, deps: WorksheetRoutesDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/courses/:courseId/worksheet.pdf',
    { schema: { params: courseParams, querystring: query } },
    async (request, reply) => {
      const { courseId } = request.params;
      const { period, from, to } = request.query;
      const context = buildContext(request.query);

      const pdf = await deps.uow.run(async (repos) => {
        const config = new ConfigService({
          repository: repos.config,
          registry: deps.configRegistry,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        const { template } = await resolveWorksheetTemplate(config);
        const data = await repos.dailyWorksheet.byCourseAndPeriod(courseId, period, {
          from: from ?? null,
          to: to ?? null,
        });
        const view = buildDailyWorksheet({ courseId, period, ...data });
        return renderDailyWorksheetPdf({ view, template, context, clock: deps.clock, layout: 'full' });
      });

      reply.type('application/pdf');
      void reply.send(Buffer.from(pdf));
    },
  );

  typed.get(
    '/courses/:courseId/students/:studentId/worksheet.pdf',
    { schema: { params: studentParams, querystring: query } },
    async (request, reply) => {
      const { courseId, studentId } = request.params;
      const { period, from, to } = request.query;
      const context = buildContext(request.query);

      const pdf = await deps.uow.run(async (repos) => {
        const config = new ConfigService({
          repository: repos.config,
          registry: deps.configRegistry,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        const { template } = await resolveWorksheetTemplate(config);
        const data = await repos.dailyWorksheet.byCourseAndPeriod(courseId, period, {
          from: from ?? null,
          to: to ?? null,
        });
        // El bloque es de **un** alumno: el roster es solo ese legajo (aunque no
        // tenga datos capturados), para que la hoja salga con secciones vacías.
        const view = buildDailyWorksheet({ courseId, period, ...data, roster: [studentId] });
        return renderDailyWorksheetPdf({
          view,
          template,
          context,
          clock: deps.clock,
          layout: 'student',
        });
      });

      reply.type('application/pdf');
      void reply.send(Buffer.from(pdf));
    },
  );
}
