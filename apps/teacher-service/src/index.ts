/**
 * `@app/teacher-service` — vertical del monorepo `app-factory`, generada por
 * `tools/create-vertical` (fase 4). Exporta el composition root y las piezas de
 * cableado al kernel.
 */
export { buildApp } from './app.js';
export type { AppDependencies } from './app.js';
export { createConfigRegistry } from './config/registry.js';
export { headerSessionResolver } from './identity.js';
export type { SessionResolver } from './identity.js';
export { runAppMigrations } from './migrations.js';
