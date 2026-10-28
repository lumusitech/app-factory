import { ScopeMissingError, buildScope, runWithScope } from '@kernel/scope';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ConfigService,
  InvalidConfigKeyError,
  InvalidConfigValueError,
  UnknownConfigKeyError,
} from './index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  createInMemoryConfigRepository,
  createRegistry,
} from '../test/support/fakes.js';
import type { InMemoryConfigRepository } from '../test/support/fakes.js';

const CLOCK = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));
const KEY = 'grading.thresholds';

const registry = createRegistry({
  [KEY]: { version: 2, accepts: (value) => typeof value === 'number' && value >= 0 },
});

const asTenant = <T>(tenantId: string, work: () => T): T =>
  runWithScope(buildScope({ tenantId, actor: { kind: 'user', id: 'user-1' } }), work);

let repository: InMemoryConfigRepository;
let service: ConfigService;

beforeEach(() => {
  repository = createInMemoryConfigRepository();
  service = new ConfigService({
    repository,
    registry,
    clock: CLOCK,
    idGenerator: new SequentialIdGenerator(),
  });
});

describe('ConfigService (casos de uso, D19)', () => {
  it('set crea la entrada, la persiste y emite el evento por outbox', async () => {
    const entry = await asTenant('tenant-a', () => service.set({ key: KEY, value: 7 }));

    expect(entry.tenantId).toBe('tenant-a');
    expect(entry.value).toBe(7);
    expect(entry.schemaVersion).toBe(2);
    expect(repository.saves()).toBe(1);
    expect(repository.events.map((event) => event.type)).toEqual(['config.entry.created']);
  });

  it('get devuelve la entrada guardada del tenant', async () => {
    await asTenant('tenant-a', () => service.set({ key: KEY, value: 7 }));

    const found = await asTenant('tenant-a', () => service.get(KEY));

    expect(found?.value).toBe(7);
    expect(found?.schemaVersion).toBe(2);
  });

  it('borde: get de una clave inexistente devuelve null', async () => {
    const found = await asTenant('tenant-a', () => service.get(KEY));
    expect(found).toBeNull();
  });

  it('set dos veces con valores distintos emite updated y vuelve a escribir', async () => {
    await asTenant('tenant-a', () => service.set({ key: KEY, value: 7 }));
    await asTenant('tenant-a', () => service.set({ key: KEY, value: 4 }));

    expect(repository.saves()).toBe(2);
    expect(repository.events.map((event) => event.type)).toEqual([
      'config.entry.created',
      'config.entry.updated',
    ]);
  });

  it('borde: set con el mismo valor no vuelve a escribir ni emite evento', async () => {
    await asTenant('tenant-a', () => service.set({ key: KEY, value: 7 }));
    const again = await asTenant('tenant-a', () => service.set({ key: KEY, value: 7 }));

    expect(again.value).toBe(7);
    expect(repository.saves()).toBe(1);
    expect(repository.events).toHaveLength(1);
  });

  it('aislamiento: dos tenants con la misma clave no se pisan', async () => {
    await asTenant('tenant-a', () => service.set({ key: KEY, value: 7 }));
    await asTenant('tenant-b', () => service.set({ key: KEY, value: 3 }));

    const a = await asTenant('tenant-a', () => service.get(KEY));
    const b = await asTenant('tenant-b', () => service.get(KEY));

    expect(a?.value).toBe(7);
    expect(b?.value).toBe(3);
  });
});

describe('ConfigService (bordes: fail-closed y validación)', () => {
  it('sin alcance lanza ScopeMissingError en get y en set', async () => {
    await expect(service.get(KEY)).rejects.toBeInstanceOf(ScopeMissingError);
    await expect(service.set({ key: KEY, value: 7 })).rejects.toBeInstanceOf(ScopeMissingError);
  });

  it('borde: una clave no registrada no se escribe', async () => {
    await expect(
      asTenant('tenant-a', () => service.set({ key: 'no.existe', value: 1 })),
    ).rejects.toBeInstanceOf(UnknownConfigKeyError);

    expect(repository.saves()).toBe(0);
  });

  it('borde: un valor inválido no se escribe', async () => {
    await expect(
      asTenant('tenant-a', () => service.set({ key: KEY, value: 'siete' })),
    ).rejects.toBeInstanceOf(InvalidConfigValueError);

    expect(repository.saves()).toBe(0);
  });

  it('borde: una clave mal formada en get lanza InvalidConfigKeyError', async () => {
    await expect(asTenant('tenant-a', () => service.get('Grading Thresholds'))).rejects.toBeInstanceOf(
      InvalidConfigKeyError,
    );
  });
});