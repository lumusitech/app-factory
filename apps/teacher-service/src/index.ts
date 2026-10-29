/**
 * `@app/teacher-service` — vertical del monorepo `app-factory`, generada por
 * `tools/create-vertical` (fase 4). Expone el composition root y las piezas de
 * cableado al kernel; el dominio del corte delgado (F-01) son los agregados
 * `ClassSession`, `Topic`, `ClassTopic`, `Assignment` y `ClassAttendance` con su
 * persistencia y su captura offline.
 */
export { buildApp } from './app.js';
export type { AppDependencies } from './app.js';
export { createConfigRegistry } from './config/registry.js';
export { headerSessionResolver } from './identity.js';
export type { SessionResolver } from './identity.js';
export { runAppMigrations } from './migrations.js';

export {
  CALENDAR_DATE_PATTERN,
  CLASS_STATUSES,
  ClassSession,
  isValidCalendarDate,
} from './domain/class-session.js';
export type {
  ClassSessionCancelInput,
  ClassSessionCreateInput,
  ClassSessionSnapshot,
  ClassSessionTransitionInput,
  ClassStatus,
} from './domain/class-session.js';
export type { ClassSessionRepository } from './domain/class-session-repository.js';

export { Topic } from './domain/topic.js';
export type { TopicCreateInput, TopicSnapshot } from './domain/topic.js';
export type { TopicRepository } from './domain/topic-repository.js';

export { ClassTopic } from './domain/class-topic.js';
export type { ClassTopicInput, ClassTopicSnapshot } from './domain/class-topic.js';
export type { ClassTopicRepository } from './domain/class-topic-repository.js';

export { Assignment } from './domain/assignment.js';
export type { AssignmentCreateInput, AssignmentSnapshot } from './domain/assignment.js';
export type { AssignmentRepository } from './domain/assignment-repository.js';

export { ATTENDANCE_STATUSES, ClassAttendance } from './domain/class-attendance.js';
export type {
  AttendanceEntry,
  AttendanceStatus,
  ClassAttendanceInput,
  ClassAttendanceSnapshot,
} from './domain/class-attendance.js';
export type { ClassAttendanceRepository } from './domain/class-attendance-repository.js';

export { registerAssignmentRoutes } from './http/assignment-routes.js';
export type { AssignmentRoutesDeps } from './http/assignment-routes.js';
export { registerClassAttendanceRoutes } from './http/class-attendance-routes.js';
export type { ClassAttendanceRoutesDeps } from './http/class-attendance-routes.js';
export { registerClassSessionRoutes } from './http/class-session-routes.js';
export type { ClassSessionRoutesDeps } from './http/class-session-routes.js';
export { registerClassTopicRoutes } from './http/class-topic-routes.js';
export type { ClassTopicRoutesDeps } from './http/class-topic-routes.js';
export type { TeacherRepositories } from './http/repositories.js';
export { registerTopicRoutes } from './http/topic-routes.js';
export type { TopicRoutesDeps } from './http/topic-routes.js';

export { PgAssignmentRepository } from './persistence/assignment-repository.js';
export { PgClassAttendanceRepository } from './persistence/class-attendance-repository.js';
export { PgClassSessionRepository } from './persistence/class-session-repository.js';
export { PgClassTopicRepository } from './persistence/class-topic-repository.js';
export { PgTopicRepository } from './persistence/topic-repository.js';

export { classSessionOfflinePolicy } from './sync/offline-policy.js';
export {
  CLASS_SESSION_PROBE_SPEC,
  ClassSessionSync,
  createClassSessionSync,
} from './sync/class-session-sync.js';
export type {
  AssignmentCapture,
  AttendanceCapture,
  ClassSessionCreateCapture,
  ClassSessionSyncPorts,
  ClassSessionTransitionCapture,
  ClassTopicCapture,
  TopicCapture,
} from './sync/class-session-sync.js';
