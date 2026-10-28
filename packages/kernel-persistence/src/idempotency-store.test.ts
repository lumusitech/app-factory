import type { IdempotencyRecord } from '@kernel/contracts';
import { idempotencyExpiry } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';
import { buildScope, runWithScope, ScopeMissingError } from '@kernel/scope';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test-support/pglite.js';
import type { TestDb } from '../test-support/pglite.js';
import { PgIdempotencyStore } from './idempotency-store.js';

class MutableClock implements Clock {
  #value: Date;

  constructor(start: Date) {
    this.#value = start;
  }

  now(): Date {
    return this.#value;
  }

  moveTo(value: Date): void {
    this.#value = value;
  }
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CREATED_AT = new Date('2026-10-28T12:00:00.000Z');

const scopeOf = (tenantId: string) =>
  buildScope({ tenantId, actor: { kind: 'user', id: 'user-1' } });

function aRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    key: 'hash-1',
    fingerprint: 'fp-1',
    statusCode: 201,
    body: { statusCode: 201, data: { id: 'note-1' } },
    createdAt: CREATED_AT,
    expiresAt: idempotencyExpiry(CREATED_AT),
    ...overrides,
  };
}

let db: TestDb;
let clock: MutableClock;
let store: PgIdempotencyStore;

beforeEach(async () => {
  db = await createTestDb();
  clock = new MutableClock(CREATED_AT);
  store = new PgIdempotencyStore(db.connection, clock);
});

afterEach(async () => {
  await db.close();
});

describe('PgIdempotencyStore (contrato de idempotencia §4/§5)', () => {
  it('guarda y recupera el registro para replay (statusCode + body verbatim)', async () => {
    await runWithScope(scopeOf(TENANT_A), () => store.save(aRecord()));

    const found = await runWithScope(scopeOf(TENANT_A), () => store.find('hash-1'));

    expect(found?.key).toBe('hash-1');
    expect(found?.fingerprint).toBe('fp-1');
    expect(found?.statusCode).toBe(201);
    expect(found?.body).toEqual({ statusCode: 201, data: { id: 'note-1' } });
    expect(found?.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    expect(found?.expiresAt.toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it('devuelve null si la clave no existe', async () => {
    const found = await runWithScope(scopeOf(TENANT_A), () => store.find('no-existe'));
    expect(found).toBeNull();
  });

  it('borde: un registro vencido se trata como inexistente (TTL 48 h)', async () => {
    await runWithScope(scopeOf(TENANT_A), () => store.save(aRecord()));

    clock.moveTo(new Date(CREATED_AT.getTime() + 48 * 60 * 60 * 1000 + 1));
    const found = await runWithScope(scopeOf(TENANT_A), () => store.find('hash-1'));

    expect(found).toBeNull();
  });

  it('borde: sin alcance lanza ScopeMissingError (fail-closed)', async () => {
    await expect(store.find('hash-1')).rejects.toBeInstanceOf(ScopeMissingError);
    await expect(store.save(aRecord())).rejects.toBeInstanceOf(ScopeMissingError);
  });

  it('aislamiento: un registro de un tenant no se ve desde otro', async () => {
    await runWithScope(scopeOf(TENANT_A), () => store.save(aRecord()));

    const found = await runWithScope(scopeOf(TENANT_B), () => store.find('hash-1'));

    expect(found).toBeNull();
  });

  it('borde: guardar dos veces la misma clave conserva el primer registro', async () => {
    await runWithScope(scopeOf(TENANT_A), () => store.save(aRecord({ fingerprint: 'fp-1' })));
    await runWithScope(scopeOf(TENANT_A), () => store.save(aRecord({ fingerprint: 'fp-2' })));

    const found = await runWithScope(scopeOf(TENANT_A), () => store.find('hash-1'));
    expect(found?.fingerprint).toBe('fp-1');
  });

  it('borde: un body `null` se conserva como `null`', async () => {
    await runWithScope(scopeOf(TENANT_A), () => store.save(aRecord({ body: null })));

    const found = await runWithScope(scopeOf(TENANT_A), () => store.find('hash-1'));
    expect(found?.body).toBeNull();
  });
});