import type { Clock, IdGenerator, UnitOfWork } from '@kernel/domain';
import { sendEnvelope } from '@kernel/http';
import { requireScope } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { isValidCalendarDate } from '../domain/class-session.js';
import {
  STUDENT_ID_MAX_LENGTH,
  STUDENT_RECORD_CATEGORY_MAX_LENGTH,
  STUDENT_RECORD_EVALUATION_ID_MAX_LENGTH,
  STUDENT_RECORD_GRADE_MAX,
  STUDENT_RECORD_GRADE_MIN,
  STUDENT_RECORD_ID_MAX_LENGTH,
  STUDENT_RECORD_NOTE_MAX_LENGTH,
  StudentRecord,
} from '../domain/student-record.js';
import type { TeacherRepositories } from './repositories.js';

/**
 * Rutas del **registro del alumno** (F-05; ADR 0015).
 *
 * `POST /students/:studentId/records` agrega una entrada (observación, movimiento
 * o evolución de una evaluación); `GET /students/:studentId/records` lista la
 * trayectoria del alumno. El `id` es **opcional**: el cliente puede aportarlo
 * (UUIDv7, D8) para capturar offline.
 */

export interface StudentRecordRoutesDeps {
  readonly uow: UnitOfWork<TeacherRepositories>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

const studentParams = z.object({
  studentId: z.string().trim().min(1).max(STUDENT_ID_MAX_LENGTH),
});

const calendarDate = z
  .string()
  .refine((value) => isValidCalendarDate(value), { message: 'Fecha de calendario inválida.' });

const baseFields = {
  id: z.string().trim().min(1).max(STUDENT_RECORD_ID_MAX_LENGTH).optional(),
  occurredOn: calendarDate,
  category: z.string().trim().min(1).max(STUDENT_RECORD_CATEGORY_MAX_LENGTH).optional(),
};

const observationBody = z.object({
  ...baseFields,
  kind: z.literal('observacion'),
  note: z.string().trim().min(1).max(STUDENT_RECORD_NOTE_MAX_LENGTH),
});

const movementBody = z.object({
  ...baseFields,
  kind: z.literal('movimiento'),
  note: z.string().trim().min(1).max(STUDENT_RECORD_NOTE_MAX_LENGTH),
});

const evaluationBody = z.object({
  ...baseFields,
  kind: z.literal('evaluacion'),
  evaluationId: z.string().trim().min(1).max(STUDENT_RECORD_EVALUATION_ID_MAX_LENGTH),
  note: z.string().trim().min(1).max(STUDENT_RECORD_NOTE_MAX_LENGTH).optional(),
  grade: z.number().int().min(STUDENT_RECORD_GRADE_MIN).max(STUDENT_RECORD_GRADE_MAX).optional(),
});

const createBody = z.discriminatedUnion('kind', [observationBody, movementBody, evaluationBody]);

const studentRecordData = z.object({
  id: z.string(),
  studentId: z.string(),
  kind: z.enum(['observacion', 'movimiento', 'evaluacion']),
  occurredOn: z.string(),
  note: z.string().nullable(),
  category: z.string().nullable(),
  evaluationId: z.string().nullable(),
  grade: z.number().int().nullable(),
  version: z.number().int(),
});

const studentRecordEnvelope = z.object({
  statusCode: z.number().int(),
  data: studentRecordData,
  timestamp: z.string(),
});

const studentRecordListEnvelope = z.object({
  statusCode: z.number().int(),
  data: z.array(studentRecordData),
  timestamp: z.string(),
});

function toResponseData(snapshot: ReturnType<StudentRecord['snapshot']>): z.infer<typeof studentRecordData> {
  return {
    id: snapshot.id,
    studentId: snapshot.studentId,
    kind: snapshot.kind,
    occurredOn: snapshot.occurredOn,
    note: snapshot.note,
    category: snapshot.category,
    evaluationId: snapshot.evaluationId,
    grade: snapshot.grade,
    version: snapshot.version,
  };
}

function toCreateInput(
  body: z.infer<typeof createBody>,
  tenantId: string,
  studentId: string,
  clock: Clock,
  idGenerator: IdGenerator,
): Parameters<typeof StudentRecord.create>[0] {
  const base = {
    tenantId,
    studentId,
    kind: body.kind,
    occurredOn: body.occurredOn,
    ...(body.id === undefined ? {} : { id: body.id }),
    ...(body.category === undefined ? {} : { category: body.category }),
    clock,
    idGenerator,
  };

  if (body.kind === 'evaluacion') {
    return {
      ...base,
      evaluationId: body.evaluationId,
      ...(body.note === undefined ? {} : { note: body.note }),
      ...(body.grade === undefined ? {} : { grade: body.grade }),
    };
  }

  return { ...base, note: body.note };
}

export function registerStudentRecordRoutes(
  app: FastifyInstance,
  deps: StudentRecordRoutesDeps,
): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/students/:studentId/records',
    { schema: { params: studentParams, body: createBody, response: { 201: studentRecordEnvelope } } },
    async (request, reply) => {
      const tenantId = requireScope().tenantId;

      const created = await deps.uow.run(async (repos) => {
        const record = StudentRecord.create(
          toCreateInput(request.body, tenantId, request.params.studentId, deps.clock, deps.idGenerator),
        );
        await repos.studentRecords.save(record);
        return record;
      });

      sendEnvelope(reply, toResponseData(created.snapshot()), deps.clock, 201);
    },
  );

  typed.get(
    '/students/:studentId/records',
    { schema: { params: studentParams, response: { 200: studentRecordListEnvelope } } },
    async (request, reply) => {
      const records = await deps.uow.run(async (repos) =>
        repos.studentRecords.listByStudent(request.params.studentId),
      );

      sendEnvelope(reply, records.map((record) => toResponseData(record.snapshot())), deps.clock);
    },
  );
}
