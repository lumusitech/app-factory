import { PGlite } from '@electric-sql/pglite';
import { fileURLToPath } from 'node:url';

import type { SqlConnection, SqlExecutor } from '../src/executor.js';
import { createPgliteConnection, createPgliteExecutor } from '../src/executor.js';
import { runMigrations } from '../src/migrations.js';

/** Dueño de la secuencia del esquema del kernel (`evolution.md` §3). */
export const KERNEL_OWNER = 'kernel-persistence';

/** Directorio de migraciones reales del paquete. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export interface TestDb {
  readonly db: PGlite;
  readonly connection: SqlConnection;
  readonly executor: SqlExecutor;
  close(): Promise<void>;
}

/**
 * Base PGlite en memoria (Postgres real, sin contenedor — D4) con el esquema del
 * kernel ya migrado. Es el soporte de los tests de persistencia.
 */
export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  const connection = createPgliteConnection(db);

  await runMigrations(connection, { owner: KERNEL_OWNER, migrationsDir: MIGRATIONS_DIR });

  return {
    db,
    connection,
    executor: createPgliteExecutor(db),
    close: () => db.close(),
  };
}