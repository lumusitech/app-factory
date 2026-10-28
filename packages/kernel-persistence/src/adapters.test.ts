import { describe, expect, it } from 'vitest';

import { SystemClock, UuidV7Generator, uuidV7 } from './adapters.js';

/** Fecha futura fija, por delante del reloj real, para tests deterministas. */
const FIXED_NOW = Date.UTC(2035, 0, 1, 0, 0, 0);

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV7 (D8)', () => {
  it('tiene la forma de UUIDv7 (versión 7 y variante RFC 4122)', () => {
    expect(uuidV7()).toMatch(UUID_V7);
  });

  it('incrusta el timestamp Unix(ms) en los 48 bits altos', () => {
    const hex = uuidV7(FIXED_NOW).replace(/-/g, '');
    expect(Number.parseInt(hex.slice(0, 12), 16)).toBe(FIXED_NOW);
  });

  it('es monótono dentro del mismo milisegundo', () => {
    const first = uuidV7(FIXED_NOW);
    const second = uuidV7(FIXED_NOW);
    expect(second > first).toBe(true);
  });

  it('no repite IDs (1000 generados)', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV7()));
    expect(ids.size).toBe(1000);
  });
});

describe('adaptadores', () => {
  it('UuidV7Generator.next() devuelve un UUIDv7', () => {
    expect(new UuidV7Generator().next()).toMatch(UUID_V7);
  });

  it('SystemClock.now() devuelve un `Date` cercano al reloj real', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});