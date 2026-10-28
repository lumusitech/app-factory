import { describe, expect, it } from 'vitest';

import { computeFingerprint, computeIdempotencyKey } from './key.js';

const base = { userId: 'user-1', method: 'POST', path: '/items', key: 'k1' };

describe('computeIdempotencyKey (contrato de idempotencia §3)', () => {
  it('produce hex minúscula de SHA-256 (64 caracteres)', () => {
    expect(computeIdempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normaliza: método en mayúsculas y key recortada', () => {
    const canonical = computeIdempotencyKey(base);
    expect(computeIdempotencyKey({ ...base, method: 'post' })).toBe(canonical);
    expect(computeIdempotencyKey({ ...base, key: '  k1  ' })).toBe(canonical);
  });

  it('distingue por userId, method, path y key', () => {
    const canonical = computeIdempotencyKey(base);
    expect(computeIdempotencyKey({ ...base, userId: 'user-2' })).not.toBe(canonical);
    expect(computeIdempotencyKey({ ...base, method: 'PUT' })).not.toBe(canonical);
    expect(computeIdempotencyKey({ ...base, path: '/other' })).not.toBe(canonical);
    expect(computeIdempotencyKey({ ...base, key: 'k2' })).not.toBe(canonical);
  });
});

describe('computeFingerprint (§7)', () => {
  it('ignora el orden de las claves (JSON canónico)', () => {
    expect(computeFingerprint({ a: 1, b: 2 })).toBe(computeFingerprint({ b: 2, a: 1 }));
  });

  it('distingue payloads distintos', () => {
    expect(computeFingerprint({ title: 'a' })).not.toBe(computeFingerprint({ title: 'b' }));
  });

  it('borde: `null`/`undefined` son la misma huella; `{}` es distinta', () => {
    expect(computeFingerprint(null)).toBe(computeFingerprint(undefined));
    expect(computeFingerprint(null)).not.toBe(computeFingerprint({}));
  });

  it('canonicaliza también dentro de arrays y objetos anidados', () => {
    expect(computeFingerprint({ list: [{ a: 1, b: 2 }] })).toBe(
      computeFingerprint({ list: [{ b: 2, a: 1 }] }),
    );
  });
});