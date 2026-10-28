import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, KERNEL_OWNER, MIGRATIONS_DIR } from '../test-support/pglite.js';
import type { TestDb } from '../test-support/pglite.js';
import * as migrationsModule from './migrations.js';
import {
  InvalidMigrationNameError,
  MigrationChecksumMismatchError,
  MigrationDivergenceError,
  runMigrations,
} from './migrations.js';

let db: TestDb;
const tempDirs: string[] = [];

async function createMigrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kernel-migrations-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(path.join(dir, name), sql, 'utf8');
  }
  return dir;
}

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runMigrations (esquema del kernel, D13)', () => {
  it('crea el esquema y registra la migración con su checksum', async () => {
    const registered = await db.executor.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM schema_migrations WHERE owner = $1 AND id = '0001-kernel-schema'`,
      [KERNEL_OWNER],
    );
    expect(registered.rows[0]?.count).toBe(1);

    const outbox = await db.executor.query<{ ok: boolean }>(
      "SELECT to_regclass('public.outbox') IS NOT NULL AS ok",
    );
    const idempotency = await db.executor.query<{ ok: boolean }>(
      "SELECT to_regclass('public.idempotency_record') IS NOT NULL AS ok",
    );
    expect(outbox.rows[0]?.ok).toBe(true);
    expect(idempotency.rows[0]?.ok).toBe(true);
  });

  it('es idempotente: una segunda corrida no aplica nada', async () => {
    const applied = await runMigrations(db.connection, {
      owner: KERNEL_OWNER,
      migrationsDir: MIGRATIONS_DIR,
    });
    expect(applied).toEqual([]);
  });

  it('aplica en orden y devuelve las migraciones nuevas con `appliedAt` del reloj inyectado', async () => {
    const dir = await createMigrationsDir({
      '0001-first.sql': 'CREATE TABLE first_t (id int);',
      '0002-second.sql': 'CREATE TABLE second_t (id int);',
    });
    const fixed = new Date('2026-10-28T12:00:00.000Z');

    const applied = await runMigrations(db.connection, {
      owner: 'test-owner',
      migrationsDir: dir,
      now: () => fixed,
    });

    expect(applied.map((migration) => migration.id)).toEqual(['0001-first', '0002-second']);
    expect(applied[0]?.appliedAt.toISOString()).toBe(fixed.toISOString());
  });
});

describe('runMigrations (bordes: inmutabilidad y divergencia, evolution.md §4)', () => {
  it('falla si una migración ya aplicada cambió de contenido (checksum)', async () => {
    const dir = await createMigrationsDir({ '0001-first.sql': 'CREATE TABLE first_t (id int);' });
    await runMigrations(db.connection, { owner: 'test-owner', migrationsDir: dir });

    await writeFile(path.join(dir, '0001-first.sql'), 'CREATE TABLE first_t (id int, extra text);', 'utf8');

    await expect(
      runMigrations(db.connection, { owner: 'test-owner', migrationsDir: dir }),
    ).rejects.toBeInstanceOf(MigrationChecksumMismatchError);
  });

  it('falla si un registro aplicado no tiene archivo en disco (divergencia)', async () => {
    const dir = await createMigrationsDir({ '0001-only.sql': 'CREATE TABLE only_t (id int);' });
    await runMigrations(db.connection, { owner: 'test-owner', migrationsDir: dir });

    await unlink(path.join(dir, '0001-only.sql'));

    await expect(
      runMigrations(db.connection, { owner: 'test-owner', migrationsDir: dir }),
    ).rejects.toBeInstanceOf(MigrationDivergenceError);
  });

  it('rechaza un nombre de migración no conforme (evolution.md §5)', async () => {
    const dir = await createMigrationsDir({ 'init.sql': 'SELECT 1;' });

    await expect(
      runMigrations(db.connection, { owner: 'test-owner', migrationsDir: dir }),
    ).rejects.toBeInstanceOf(InvalidMigrationNameError);
  });
});

describe('runMigrations (bordes: transacción por migración)', () => {
  it('una migración que falla no se registra y revierte su efecto parcial', async () => {
    const dir = await createMigrationsDir({
      '0001-partial.sql': 'CREATE TABLE partial_t (id int); INSERT INTO tabla_inexistente VALUES (1);',
    });

    await expect(
      runMigrations(db.connection, { owner: 'test-owner', migrationsDir: dir }),
    ).rejects.toThrow();

    const registered = await db.executor.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM schema_migrations WHERE owner = 'test-owner'`,
    );
    const created = await db.executor.query<{ ok: boolean }>(
      "SELECT to_regclass('public.partial_t') IS NOT NULL AS ok",
    );
    expect(registered.rows[0]?.count).toBe(0);
    expect(created.rows[0]?.ok).toBe(false);
  });

  it('no expone ninguna API de revert/rollback/down (forward-only)', () => {
    const forbidden = Object.keys(migrationsModule).filter((name) => /revert|rollback|down/i.test(name));
    expect(forbidden).toEqual([]);
  });
});