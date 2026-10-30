import type { OfflinePolicy } from '@kernel/client';
import type { QueuedRequestMethod } from '@kernel/contracts';

/**
 * Política offline de `teacher-service` (F-01/F-02/F-03): qué mutaciones de captura
 * son encolables (`docs/contracts/sync.md` §1). El núcleo del cliente no conoce
 * estas rutas (§1.2): las inyecta la vertical.
 *
 * Encolables:
 * - `POST /class-sessions` (crear clase) y `PATCH /class-sessions/:id` (transición);
 * - `POST /courses/:courseId/topics` (crear tema del plan);
 * - `PUT /class-sessions/:id/topic` (fijar el tema dictado);
 * - `PUT /class-sessions/:id/attendance` (asistencia de la clase);
 * - `POST /class-sessions/:id/assignments` (crear tarea);
 * - `POST /courses/:courseId/evaluations` (crear evaluación; F-02);
 * - `PUT /evaluations/:id/grades` (cargar notas de la evaluación; F-02);
 * - `PUT /courses/:courseId/trajectory-assessments/:period` (valoración
 *   preliminar TEA/TEP/TED; F-03);
 * - `POST /students/:studentId/records` (registro/trayectoria del alumno; F-05).
 *
 * El resto —lecturas y el probe— nunca se encola.
 */

const CLASS_SESSION_PATH = '/class-sessions';
const CLASS_SESSION_BY_ID = /^\/class-sessions\/[^/]+$/;
const COURSE_TOPICS = /^\/courses\/[^/]+\/topics$/;
const CLASS_SESSION_TOPIC = /^\/class-sessions\/[^/]+\/topic$/;
const CLASS_SESSION_ATTENDANCE = /^\/class-sessions\/[^/]+\/attendance$/;
const CLASS_SESSION_ASSIGNMENTS = /^\/class-sessions\/[^/]+\/assignments$/;
const COURSE_EVALUATIONS = /^\/courses\/[^/]+\/evaluations$/;
const EVALUATION_GRADES = /^\/evaluations\/[^/]+\/grades$/;
const COURSE_TRAJECTORY_ASSESSMENTS = /^\/courses\/[^/]+\/trajectory-assessments\/[^/]+$/;
const STUDENT_RECORDS = /^\/students\/[^/]+\/records$/;

export const classSessionOfflinePolicy: OfflinePolicy = {
  isQueueable(method: QueuedRequestMethod, path: string): boolean {
    if (method === 'POST') {
      return (
        path === CLASS_SESSION_PATH ||
        COURSE_TOPICS.test(path) ||
        CLASS_SESSION_ASSIGNMENTS.test(path) ||
        COURSE_EVALUATIONS.test(path) ||
        STUDENT_RECORDS.test(path)
      );
    }
    if (method === 'PATCH') {
      return CLASS_SESSION_BY_ID.test(path);
    }
    if (method === 'PUT') {
      return (
        CLASS_SESSION_TOPIC.test(path) ||
        CLASS_SESSION_ATTENDANCE.test(path) ||
        EVALUATION_GRADES.test(path) ||
        COURSE_TRAJECTORY_ASSESSMENTS.test(path)
      );
    }
    return false;
  },
};
