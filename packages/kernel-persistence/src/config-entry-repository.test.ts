import type { ConfigEntry, ConfigSchemaRegistry } from '@kernel/config';
import { ConfigEntry as ConfigEntryValue } from '@kernel/config';
import type { Clock, IdGenerator } from '@kernel/domain';
import { buildScope, requireScope, runWithScope } from '@kernel/scope';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test-support/pglite.js';
import type { TestDb } from '../test-support/pglite.js';
import { PgConfigEntryRepository } from './config-entry-repository.js';
import { PgOutboxPort } from './outbox.js';
import { PgUnitOfWork } from './unit-of-work.js';

const KEY = 'grading.thresholds';

const registry: ConfigSchemaRegistry = {
  currentVersion: (key) => (key === KEY ? 2 : null),
  isValid: (key, schemaVersion, value) =>
    key === KEY && schemaVersion === 2 && typeof value === 'number' && value >= 0,
};

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-28T12:00:00.000Z');
  }
}

class SequentialIds implements IdGenerator {
  #counter = 0;

  next(): string {
    this.#counter += 1;
    return `id-${this.#counter}`;
  }
}

type Repositories = { readonly config: PgConfigEntryRepository };

const scopeOf = (tenantId: string) =>
  buildScope({ tenantId, actor: { kind: 'user', id: 'user-1' } });

let db: TestDb;
let uow: PgUnitOfWork<Repositories>;
const clock = new FixedClock();
const ids = new SequentialIds();

function anEntry(tenantId: string, value: number): ConfigEntry {
  return ConfigEntryValue.create({
    tenantId,
    key: KEY,
    value,
    registry,
    clock,
    idGenerator: ids,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  uow = new PgUnitOfWork<Repositories>(db.connection, (context) => ({
    config: new PgConfigEntryRepository(context, new PgOutboxPort(context)),
  }));
});

afterEach(async () => {
  await db.close();
});

async function countRows(table: 'config_entry' | 'outbox'): Promise<number> {
  const { rows } = await db.executor.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return rows[0]?.count ?? -1;
}

describe('PgConfigEntryRepository (ADR 0007)', () => {
  it('guarda y recupera la entrada con el tenant del ScopeContext', async () => {
    await runWithScope(scopeOf('tenant-a'), () =>
      uow.run(async ({ config }) => {
        await config.save(anEntry(requireScope().tenantId, 7));
      }),
    );

    const found = await runWithScope(scopeOf('tenant-a'), () =>
      uow.run(async ({ config }) => config.byKey(KEY)),
    );

    expect(found?.tenantId).toBe('tenant-a');
    expect(found?.value).toBe(7);
    expect(found?.schemaVersion).toBe(2);
    expect(found?.updatedAt.toISOString()).toBe('2026-10-28T12:00:00.000Z');
  });

  it('emite el evento al outbox en la misma transacción', async () => {
    await runWithScope(scopeOf('tenant-a'), () =>
      uow.run(async ({ config }) => {
        await config.save(anEntry('tenant-a', 7));
      }),
    );

    const { rows } = await db.executor.query<{
      tenant_id: string;
      type: string;
      payload: { key: string; schemaVersion: number; value: number };
    }>('SELECT tenant_id, type, payload FROM outbox');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe('tenant-a');
    expect(rows[0]?.type).toBe('config.entry.created');
    expect(rows[0]?.payload).toEqual({ key: KEY, schemaVersion: 2, value: 7 });
  });

  it('borde: rollback no deja ni la entrada ni el evento', async () => {
    await expect(
      runWithScope(scopeOf('tenant-a'), () =>
        uow.run(async ({ config }) => {
          await config.save(anEntry('tenant-a', 7));
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');

    expect(await countRows('config_entry')).toBe(0);
    expect(await countRows('outbox')).toBe(0);
  });

  it('aislamiento: la entrada de un tenant no se ve desde otro', async () => {
    await runWithScope(scopeOf('tenant-a'), () =>
      uow.run(async ({ config }) => {
        await config.save(anEntry('tenant-a', 7));
      }),
    );

    const foreign = await runWithScope(scopeOf('tenant-b'), () =>
      uow.run(async ({ config }) => config.byKey(KEY)),
    );
    const own = await runWithScope(scopeOf('tenant-a'), () =>
      uow.run(async ({ config }) => config.byKey(KEY)),
    );

    expect(foreign).toBeNull();
    expect(own?.value).toBe(7);
  });

  it('borde: la RLS de config_entry aísla por tenant (backstop D12)', async () => {
    await runWithScope(scopeOf('tenant-a'), () =>
      uow.run(async ({ config }) => {
        await config.save(anEntry('tenant-a', 7));
      }),
    );
    await runWithScope(scopeOf('tenant-b'), () =>
      uow.run(async ({ config }) => {
        await config.save(anEntry('tenant-b', 3));
      }),
    );

    await db.executor.exec(
      'CREATE ROLE config_runtime NOLOGIN; GRANT SELECT ON config_entry TO config_runtime; SET ROLE config_runtime;',
    );

    const asRole = await db.connection.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", ['tenant-a']);
      const result = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM config_entry');
      return result.rows;
    });

    expect(asRole.map((row) => row.tenant_id)).toEqual(['tenant-a']);
  });
});