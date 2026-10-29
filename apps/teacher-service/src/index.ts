/**
 * `@app/teacher-service` — vertical del monorepo `app-factory`, generada por
 * `tools/create-vertical` (fase 4). Expone el composition root y las piezas de
 * cableado al kernel; el dominio del corte delgado (F-01, Slice A) es el
 * agregado `ClassSession` y su persistencia.
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
export { registerClassSessionRoutes } from './http/class-session-routes.js';
export type {
  ClassSessionRepositories,
  ClassSessionRoutesDeps,
} from './http/class-session-routes.js';
export { PgClassSessionRepository } from './persistence/class-session-repository.js';
export { rowToSnapshot, snapshotToParams } from './persistence/class-session-row.js';
export type { ClassSessionRow } from './persistence/class-session-row.js';
