import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * El schema es normativo (sync §7). Estos tests ejercitan el archivo real que se
 * publica, no una copia: si el schema y los tests divergen, el archivo gana.
 */
const schemaUrl = new URL('../schemas/queued-request.schema.json', import.meta.url);

/** ISO 8601 `date-time` (draft 2020-12), sin depender de `ajv-formats`. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

let validate: ValidateFunction;

beforeAll(() => {
  const schema: unknown = JSON.parse(readFileSync(fileURLToPath(schemaUrl), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value: string) => ISO_DATE_TIME.test(value),
  });
  validate = ajv.compile(schema as object);
});

const pending = {
  id: '018f0a3c-0000-7000-8000-000000000000',
  order: 0,
  method: 'POST',
  path: '/work-orders',
  body: { title: 'Cambiar aceite' },
  idempotencyKey: 'op-123',
  state: 'pending',
  createdAt: '2026-10-28T12:00:00.000Z',
  attempts: 0,
};

describe('queued-request.schema.json', () => {
  it('valida un item `pending` canónico', () => {
    expect(validate(pending)).toBe(true);
  });

  it('acepta `body: null` (DELETE) y los campos opcionales ausentes', () => {
    const { body: _body, ...withoutBody } = pending;
    expect(validate({ ...withoutBody, body: null, method: 'DELETE' })).toBe(true);
    expect(validate(withoutBody)).toBe(true);
  });

  it('acepta un item `blocked` con su `blockedReason`', () => {
    expect(
      validate({
        ...pending,
        state: 'blocked',
        attempts: 1,
        lastAttemptAt: '2026-10-28T12:05:00.000Z',
        blockedReason: { statusCode: 409, message: 'Conflicto de versión', error: 'SYNC_VERSION_CONFLICT' },
      }),
    ).toBe(true);
  });

  it('rechaza un item sin `idempotencyKey` (precondición de encolado, sync §1)', () => {
    const { idempotencyKey: _key, ...invalid } = pending;
    expect(validate(invalid)).toBe(false);
  });

  it('rechaza un `method` fuera del enum (solo mutaciones)', () => {
    expect(validate({ ...pending, method: 'GET' })).toBe(false);
  });

  it('rechaza un `state` desconocido', () => {
    expect(validate({ ...pending, state: 'sending' })).toBe(false);
  });

  it('rechaza `order` negativo y `attempts` negativo', () => {
    expect(validate({ ...pending, order: -1 })).toBe(false);
    expect(validate({ ...pending, attempts: -1 })).toBe(false);
  });

  it('rechaza propiedades adicionales', () => {
    expect(validate({ ...pending, unexpected: true })).toBe(false);
  });

  it('rechaza un `createdAt` que no es `date-time` ISO 8601', () => {
    expect(validate({ ...pending, createdAt: 'ayer' })).toBe(false);
  });
});
