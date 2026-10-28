import { describe, expect, it } from 'vitest';

import { IDEMPOTENCY_TTL_HOURS, idempotencyExpiry } from './idempotency.js';

describe('ventana de idempotencia (contrato de idempotencia §4)', () => {
  it('el TTL es de 48 h y no se re-litiga', () => {
    expect(IDEMPOTENCY_TTL_HOURS).toBe(48);
  });

  it('idempotencyExpiry suma 48 h al instante de creación', () => {
    const createdAt = new Date('2026-10-28T12:00:00.000Z');
    expect(idempotencyExpiry(createdAt).toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it('borde: no muta el instante de creación', () => {
    const createdAt = new Date('2026-10-28T12:00:00.000Z');
    idempotencyExpiry(createdAt);
    expect(createdAt.toISOString()).toBe('2026-10-28T12:00:00.000Z');
  });
});