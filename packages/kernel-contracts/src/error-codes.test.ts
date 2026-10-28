import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_STATUS, isErrorCode } from './error-codes.js';

describe('ERROR_CODES', () => {
  it('el conflicto de idempotencia es 409 (idempotency §6, §7, §10)', () => {
    expect(ERROR_STATUS[ERROR_CODES.IDEMPOTENCY_CONFLICT]).toBe(409);
  });

  it('el conflicto de versión de sync es 409 (sync §8.2, §9)', () => {
    expect(ERROR_STATUS[ERROR_CODES.SYNC_VERSION_CONFLICT]).toBe(409);
  });

  it('el alcance faltante es un error del servidor (scope §6.2)', () => {
    expect(ERROR_STATUS[ERROR_CODES.SCOPE_MISSING]).toBe(500);
  });

  it('idempotencia y sync usan códigos distintos (no se confunden causas)', () => {
    expect(ERROR_CODES.IDEMPOTENCY_CONFLICT).not.toBe(ERROR_CODES.SYNC_VERSION_CONFLICT);
  });

  it('cada código tiene un status HTTP de error válido', () => {
    for (const code of Object.values(ERROR_CODES)) {
      const status = ERROR_STATUS[code];
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('el mapeo cubre exactamente el catálogo (ni de más ni de menos)', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...Object.values(ERROR_CODES)].sort());
  });
});

describe('isErrorCode', () => {
  it('acepta un código del catálogo y rechaza cualquier otro valor', () => {
    expect(isErrorCode(ERROR_CODES.NOT_FOUND)).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(409)).toBe(false);
  });
});
