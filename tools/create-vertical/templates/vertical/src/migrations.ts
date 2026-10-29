import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SqlConnection } from '@kernel/persistence';
import { runMigrations } from '@kernel/persistence';

const require = createRequire(import.meta.url);

/** Dueño del esquema del kernel ([`docs/contracts/evolution.md`](../../../docs/contracts/evolution.md) §3). */
const KERNEL_OWNER = 'kernel-persistence';
/** Dueño del esquema de esta vertical: uno solo, el propio. */
const APP_OWNER = '{{NAME}}';

const KERNEL_MIGRATIONS_DIR = path.dirname(
  require.resolve('@kernel/persistence/migrations/0001-kernel-schema.sql'),
);
const APP_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Aplica, **forward-only**, las migraciones del kernel y las propias (§3–§4).
 * Cada dueño tiene su secuencia; este despliegue aplica las dos.
 */
export async function runAppMigrations(connection: SqlConnection): Promise<void> {
  await runMigrations(connection, { owner: KERNEL_OWNER, migrationsDir: KERNEL_MIGRATIONS_DIR });
  await runMigrations(connection, { owner: APP_OWNER, migrationsDir: APP_MIGRATIONS_DIR });
}
