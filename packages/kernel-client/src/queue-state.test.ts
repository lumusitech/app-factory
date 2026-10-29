import type { QueuedRequest } from '@kernel/contracts';
import { describe, expect, it } from 'vitest';

import {
  blockedReason,
  classifyResult,
  classifyStatusCode,
  markAttempt,
  markBlocked,
  markRequeued,
  markRetained,
} from './queue-state.js';

const ITEM: QueuedRequest = {
  id: 'id-1',
  order: 0,
  method: 'POST',
  path: '/a',
  body: null,
  idempotencyKey: 'k1',
  baseVersion: null,
  state: 'pending',
  createdAt: '2026-10-29T12:00:00.000Z',
  attempts: 0,
  lastAttemptAt: null,
  blockedReason: null,
};

describe('classifyStatusCode (sync §4)', () => {
  it('2xx → applied', () => {
    expect(classifyStatusCode(200, null).kind).toBe('applied');
    expect(classifyStatusCode(201, null).kind).toBe('applied');
    expect(classifyStatusCode(204, null).kind).toBe('applied');
  });

  it('401 y 4xx (incluido 409) → blocked con motivo', () => {
    expect(classifyStatusCode(401, { message: 'x', error: 'UNAUTHORIZED' })).toMatchObject({
      kind: 'blocked',
      reason: { statusCode: 401, error: 'UNAUTHORIZED' },
    });
    expect(classifyStatusCode(409, { message: 'x', error: 'SYNC_VERSION_CONFLICT' }).kind).toBe('blocked');
  });

  it('5xx → retained', () => {
    expect(classifyStatusCode(500, null).kind).toBe('retained');
    expect(classifyStatusCode(503, null).kind).toBe('retained');
  });
});

describe('classifyResult', () => {
  it('un error de red es retained (indeterminado)', () => {
    expect(classifyResult({ kind: 'network-error' }).kind).toBe('retained');
  });
});

describe('transiciones puras', () => {
  it('markAttempt suma attempts y fija lastAttemptAt', () => {
    expect(markAttempt(ITEM, '2026-10-29T12:05:00.000Z')).toMatchObject({
      attempts: 1,
      lastAttemptAt: '2026-10-29T12:05:00.000Z',
    });
  });

  it('markRetained conserva en pending y limpia el motivo de bloqueo', () => {
    const blocked = markBlocked(ITEM, '2026-10-29T12:05:00.000Z', blockedReason(401, {}));
    expect(markRetained(blocked, '2026-10-29T12:06:00.000Z')).toMatchObject({
      state: 'pending',
      blockedReason: null,
      attempts: 2,
    });
  });

  it('markBlocked deja el item visible con su motivo', () => {
    expect(markBlocked(ITEM, '2026-10-29T12:05:00.000Z', blockedReason(500, {}))).toMatchObject({
      state: 'blocked',
      attempts: 1,
    });
  });

  it('markRequeued vuelve a pending y limpia el motivo', () => {
    const blocked = markBlocked(ITEM, '2026-10-29T12:05:00.000Z', blockedReason(401, {}));
    expect(markRequeued(blocked)).toMatchObject({ state: 'pending', blockedReason: null });
  });

  it('blockedReason sintetiza un motivo si el body no es un envelope de error', () => {
    expect(blockedReason(418, 'texto plano')).toEqual({
      statusCode: 418,
      message: 'Mutación rechazada.',
      error: null,
    });
  });
});
