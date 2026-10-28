import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SqlConnection } from './executor.js';

/** Una migración leída del disco, con su checksum del contenido. */
export interface Migration {
  readonly id: string;
  readonly sql: string;
  /** SHA-256 hex del contenido del archivo (inmutabilidad, `evolution.md` §4). */
  readonly checksum: string;
}

/** Registro de una migración aplicada (`schema_migrations`). */
export interface AppliedMigration {
  readonly owner: string;
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface RunMigrationsOptions {
  /** Dueño de la secuencia (`kernel-persistence`, `evolution.md` §3). */
  readonly owner: string;
  readonly migrationsDir: string;
  /** Reloj inyectable para `applied_at` (tests deterministas). */
  readonly now?: () => Date;
}

export class InvalidMigrationNameError extends Error {
  constructor(readonly fileName: string) {
    super(
      `Nombre de migración inválido: "${fileName}". Debe ser NNNN-kebab-case.sql (evolution.md §5).`,
    );
    this.name = 'InvalidMigrationNameError';
  }
}

export class MigrationChecksumMismatchError extends Error {
  constructor(
    readonly owner: string,
    readonly migrationId: string,
  ) {
    super(
      `La migración ${migrationId} del dueño ${owner} ya fue aplicada y su contenido cambió (checksum distinto). Una migración aplicada es inmutable (evolution.md §4).`,
    );
    this.name = 'MigrationChecksumMismatchError';
  }
}

export class MigrationDivergenceError extends Error {
  constructor(
    readonly owner: string,
    readonly migrationId: string,
  ) {
    super(
      `La migración ${migrationId} del dueño ${owner} figura aplicada pero no existe en disco: divergencia entre archivo y registro (evolution.md §4).`,
    );
    this.name = 'MigrationDivergenceError';
  }
}

const MIGRATION_FILE = /^(\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/;

const CREATE_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  owner      text        NOT NULL,
  id         text        NOT NULL,
  checksum   text        NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (owner, id)
)`;

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Lee y ordena las migraciones de un dueño. Falla ante nombres no conformes. */
export async function loadMigrations(migrationsDir: string): Promise<readonly Migration[]> {
  const entries = (await readdir(migrationsDir)).filter((entry) => entry.endsWith('.sql'));

  const migrations: Migration[] = [];
  for (const entry of entries) {
    const match = MIGRATION_FILE.exec(entry);
    if (match === null) {
      throw new InvalidMigrationNameError(entry);
    }
    const id = match[1] ?? entry;
    const sql = await readFile(path.join(migrationsDir, entry), 'utf8');
    migrations.push({ id, sql, checksum: sha256(sql) });
  }

  return migrations.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Aplica las migraciones pendientes de un dueño. **Forward-only**:
 *
 * - aplica en orden, cada migración en su propia transacción (todo o nada);
 * - registra `(owner, id, checksum, applied_at)` en `schema_migrations`;
 * - **falla** si una migración ya aplicada cambió de checksum;
 * - **falla** si un registro aplicado no tiene archivo (divergencia);
 * - **no expone** `down`, `revert` ni `rollback` (evolution.md §4).
 *
 * Es idempotente: una segunda corrida sin cambios aplica cero migraciones.
 */
export async function runMigrations(
  connection: SqlConnection,
  options: RunMigrationsOptions,
): Promise<readonly AppliedMigration[]> {
  const now = options.now ?? (() => new Date());

  await connection.transaction(async (tx) => {
    await tx.exec(CREATE_TRACKING_TABLE);
  });

  const files = await loadMigrations(options.migrationsDir);

  const applied = await connection.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM schema_migrations WHERE owner = $1 ORDER BY id',
      [options.owner],
    );
    return rows;
  });

  const appliedById = new Map(applied.map((row) => [row.id, row] as const));
  const filesById = new Set(files.map((file) => file.id));

  for (const row of applied) {
    if (!filesById.has(row.id)) {
      throw new MigrationDivergenceError(options.owner, row.id);
    }
  }

  const newlyApplied: AppliedMigration[] = [];

  for (const file of files) {
    const previous = appliedById.get(file.id);

    if (previous !== undefined) {
      if (previous.checksum !== file.checksum) {
        throw new MigrationChecksumMismatchError(options.owner, file.id);
      }
      continue;
    }

    const appliedAt = now();

    await connection.transaction(async (tx) => {
      await tx.exec(file.sql);
      await tx.query(
        'INSERT INTO schema_migrations (owner, id, checksum, applied_at) VALUES ($1, $2, $3, $4)',
        [options.owner, file.id, file.checksum, appliedAt],
      );
    });

    newlyApplied.push({
      owner: options.owner,
      id: file.id,
      checksum: file.checksum,
      appliedAt,
    });
  }

  return newlyApplied;
}