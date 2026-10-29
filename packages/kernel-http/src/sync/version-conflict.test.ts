import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../test/support/fakes.js';
import {
  hasVersionConflict,
  resolveVersionConflict,
  syncVersionConflictError,
} from './version-conflict.js';

const clock = new FixedClock(new Date('2026-10-29T12:00:00.000Z'));

describe('hasVersionConflict (sync §8.1)', () => {
  it('sin `baseVersion` no hay conflicto (la operación no versiona)', () => {
    expect(hasVersionConflict({ baseVersion: null, currentVersion: 'v3' })).toBe(false);
    expect(hasVersionConflict({ baseVersion: '', currentVersion: 'v3' })).toBe(false);
    expect(hasVersionConflict({ baseVersion: undefined, currentVersion: 'v3' })).toBe(false);
  });

  it('`baseVersion` coincidente no es conflicto', () => {
    expect(hasVersionConflict({ baseVersion: 'v3', currentVersion: 'v3' })).toBe(false);
  });

  it('`baseVersion` anterior es conflicto (comparación opaca)', () => {
    expect(hasVersionConflict({ baseVersion: 'v1', currentVersion: 'v3' })).toBe(true);
  });
});

describe('resolveVersionConflict (sync §8.2)', () => {
  const base = { baseVersion: 'v1', currentVersion: 'v3', actor: 'user-1', deviceLabel: 'web', clock };

  it('sin conflicto devuelve `none`', () => {
    expect(
      resolveVersionConflict({ baseVersion: 'v3', currentVersion: 'v3', policy: 'blocked', actor: 'u', deviceLabel: 'web', clock }),
    ).toEqual({ kind: 'none' });
  });

  it('conflicto con política `blocked` (default) → `blocked`', () => {
    expect(resolveVersionConflict({ ...base, policy: 'blocked' }).kind).toBe('blocked');
  });

  it('conflicto con política `lww` → señal de sobrescritura con la versión pisada', () => {
    expect(resolveVersionConflict({ ...base, policy: 'lww' })).toEqual({
      kind: 'lww',
      signal: {
        previousVersion: 'v3',
        actor: 'user-1',
        deviceLabel: 'web',
        at: '2026-10-29T12:00:00.000Z',
      },
    });
  });
});

describe('syncVersionConflictError', () => {
  it('es un 409 con el código del catálogo', () => {
    const error = syncVersionConflictError();
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('SYNC_VERSION_CONFLICT');
  });
});
