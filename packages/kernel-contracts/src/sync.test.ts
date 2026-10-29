import { describe, expect, it } from 'vitest';

import { DEFAULT_SYNC_POLICY, type OverwriteSignal } from './sync.js';

describe('política de conflicto de sync', () => {
  it('el default del kernel es `blocked` (sync §8.2)', () => {
    expect(DEFAULT_SYNC_POLICY).toBe('blocked');
  });

  it('la señal de sobrescritura lleva los campos mínimos de §8.2', () => {
    const signal: OverwriteSignal = {
      previousVersion: 'v1',
      actor: 'user-1',
      deviceLabel: 'Android · Pixel 8',
      at: '2026-10-29T12:00:00.000Z',
    };
    expect(Object.keys(signal).sort()).toEqual(
      ['actor', 'at', 'deviceLabel', 'previousVersion'].sort(),
    );
  });
});
