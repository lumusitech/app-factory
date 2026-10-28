import { describe, expect, it } from 'vitest';

import { FixedClock, SequentialIdGenerator, createRegistry } from '../test/support/fakes.js';
import {
  ConfigEntry,
  InvalidConfigKeyError,
  InvalidConfigValueError,
  UnknownConfigKeyError,
} from './index.js';

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));

const registry = createRegistry({
  'grading.thresholds': { version: 2, accepts: (value) => typeof value === 'number' && value >= 0 },
  'calendar.term': { version: 1, accepts: (value) => Array.isArray(value) },
});

const createInput = (overrides: Partial<Parameters<typeof ConfigEntry.create>[0]> = {}) => ({
  tenantId: 'tenant-a',
  key: 'grading.thresholds',
  value: 7,
  registry,
  clock: CLOCK,
  idGenerator: new SequentialIdGenerator(),
  ...overrides,
});

describe('ConfigEntry.create (invariantes, ADR 0007)', () => {
  it('estampa la versión de esquema del catálogo y emite `config.entry.created`', () => {
    const entry = ConfigEntry.create(createInput());

    expect(entry.tenantId).toBe('tenant-a');
    expect(entry.key).toBe('grading.thresholds');
    expect(entry.value).toBe(7);
    expect(entry.schemaVersion).toBe(2);
    expect(entry.updatedAt.toISOString()).toBe('2026-10-28T12:00:00.000Z');

    expect(entry.pullEvents()).toEqual([
      {
        id: 'id-1',
        type: 'config.entry.created',
        aggregateId: 'grading.thresholds',
        occurredAt: CLOCK.now(),
        payload: { key: 'grading.thresholds', schemaVersion: 2, value: 7 },
      },
    ]);
  });

  it('borde: rechaza una clave mal formada', () => {
    for (const key of ['', '   ', 'Grading', 'grading thresholds', 'grading..thresholds', 'a'.repeat(121)]) {
      expect(() => ConfigEntry.create(createInput({ key }))).toThrow(InvalidConfigKeyError);
    }
  });

  it('borde: rechaza una clave no registrada en el catálogo (fail-closed)', () => {
    expect(() => ConfigEntry.create(createInput({ key: 'no.existe' }))).toThrow(UnknownConfigKeyError);
  });

  it('borde: rechaza un valor que no cumple el esquema vigente', () => {
    expect(() => ConfigEntry.create(createInput({ value: 'siete' }))).toThrow(InvalidConfigValueError);
    expect(() => ConfigEntry.create(createInput({ value: -1 }))).toThrow(InvalidConfigValueError);
  });
});

describe('ConfigEntry.replaceValue', () => {
  it('emite `config.entry.updated` y reestampa la versión de esquema vigente', () => {
    const entry = ConfigEntry.create(createInput({ idGenerator: new SequentialIdGenerator() }));
    entry.pullEvents();

    const updated = entry.replaceValue({
      value: 4,
      registry,
      clock: CLOCK,
      idGenerator: new SequentialIdGenerator(),
    });

    expect(updated).not.toBe(entry);
    expect(updated.value).toBe(4);
    expect(updated.schemaVersion).toBe(2);
    expect(updated.pullEvents()).toEqual([
      {
        id: 'id-1',
        type: 'config.entry.updated',
        aggregateId: 'grading.thresholds',
        occurredAt: CLOCK.now(),
        payload: { key: 'grading.thresholds', schemaVersion: 2, value: 4 },
      },
    ]);
  });

  it('borde: un valor idéntico (estructura profunda) no crea entrada nueva ni evento', () => {
    const arrayRegistry = createRegistry({ 'calendar.term': { version: 1, accepts: () => true } });
    const entry = ConfigEntry.create(
      createInput({ key: 'calendar.term', value: [{ from: '2026-03-01' }], registry: arrayRegistry }),
    );
    entry.pullEvents();

    const same = entry.replaceValue({
      value: [{ from: '2026-03-01' }],
      registry: arrayRegistry,
      clock: CLOCK,
      idGenerator: new SequentialIdGenerator(),
    });

    expect(same).toBe(entry);
    expect(same.pullEvents()).toEqual([]);
  });

  it('borde: el valor nuevo también se valida', () => {
    const entry = ConfigEntry.create(createInput());
    expect(() =>
      entry.replaceValue({ value: 99, registry, clock: CLOCK, idGenerator: new SequentialIdGenerator() }),
    ).not.toThrow();
    expect(() =>
      entry.replaceValue({ value: -5, registry, clock: CLOCK, idGenerator: new SequentialIdGenerator() }),
    ).toThrow(InvalidConfigValueError);
  });
});

describe('ConfigEntry.hydrate', () => {
  it('reconstruye sin revalidar el valor contra el esquema vigente (una entrada puede quedar vieja)', () => {
    const stale = ConfigEntry.hydrate({
      tenantId: 'tenant-a',
      key: 'grading.thresholds',
      value: 'un valor que ya no valida',
      schemaVersion: 1,
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(stale.schemaVersion).toBe(1);
    expect(stale.value).toBe('un valor que ya no valida');
    expect(stale.pullEvents()).toEqual([]);
  });

  it('borde: rechaza una versión de esquema inválida', () => {
    expect(() =>
      ConfigEntry.hydrate({
        tenantId: 'tenant-a',
        key: 'grading.thresholds',
        value: 7,
        schemaVersion: 0,
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});