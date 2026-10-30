import type { ConfigSchemaRegistry } from '@kernel/config';
import { ConfigService } from '@kernel/config';
import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { renderOfficialSheetPdf } from '../documents/pdf-renderer.js';
import { officialSheetTemplatePeriods } from '../documents/template.js';
import { resolveOfficialSheetTemplate } from '../documents/template-catalog.js';
import { COURSE_ID_MAX_LENGTH } from '../domain/evaluation.js';
import { buildOfficialSheet } from '../domain/official-sheet.js';
import { buildContext, contextQuery } from './context-query.js';
import type { TeacherRepositories } from './repositories.js';

/**
 * Ruta de la planilla oficial (F-04; ADR 0014).
 *
 * `GET /courses/:courseId/official-sheet.pdf` **deriva** la planilla (vista, T6) y
 * la renderiza a **PDF** en el **servidor** (§10). Es una **lectura**: no lleva
 * idempotencia ni sync, y la respuesta es binaria (`application/pdf`), **fuera**
 * del envelope JSON del kernel (que envuelve respuestas de datos). La cabecera que
 * no se puede derivar (escuela, materia, división, ciclo, docente) viaja por
 * **query params opacos** que la plantilla mapea (`context.*`).
 */

export interface OfficialSheetRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly configRegistry: ConfigSchemaRegistry;
}

const routeParams = z.object({
  courseId: z.string().trim().min(1).max(COURSE_ID_MAX_LENGTH),
});

export function registerOfficialSheetRoutes(
  app: FastifyInstance,
  deps: OfficialSheetRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/courses/:courseId/official-sheet.pdf',
    { schema: { params: routeParams, querystring: contextQuery } },
    async (request, reply) => {
      const { courseId } = request.params;
      const context = buildContext(request.query);

      const pdf = await deps.uow.run(async (repos) => {
        const config = new ConfigService({
          repository: repos.config,
          registry: deps.configRegistry,
          clock: deps.clock,
          idGenerator: deps.idGenerator,
        });
        const { template } = await resolveOfficialSheetTemplate(config);
        const periods = officialSheetTemplatePeriods(template);
        const data = await repos.officialSheet.byCourse(courseId);
        const view = buildOfficialSheet({ courseId, periods, ...data });
        return renderOfficialSheetPdf({ view, template, context, clock: deps.clock });
      });

      reply.type('application/pdf');
      void reply.send(Buffer.from(pdf));
    },
  );
}
