import { describe, expect, it } from 'vitest';

import {
  buildScope,
  getScope,
  requireScope,
  runWithScope,
  ScopeMissingError,
} from './index.js';

const scopeOf = (tenantId: string) =>
  buildScope({ tenantId, actor: { kind: 'user', id: `user-${tenantId}` } });

describe('alcance sin poblar (fail-closed, scope.md §6.2)', () => {
  it('getScope no encuentra alcance fuera de runWithScope', () => {
    expect(getScope()).toBeUndefined();
  });

  it('requireScope lanza ScopeMissingError en vez de devolver un alcance vacío', () => {
    expect(() => requireScope()).toThrow(ScopeMissingError);
  });
});

describe('runWithScope', () => {
  it('expone el alcance de forma sincrónica', () => {
    const scope = scopeOf('t1');
    runWithScope(scope, () => {
      expect(requireScope()).toBe(scope);
    });
  });

  it('propaga el alcance a través de awaits', async () => {
    const scope = scopeOf('t1');
    await runWithScope(scope, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requireScope().tenantId).toBe('t1');
    });
  });

  it('lo limpia al salir: fuera del run no queda alcance', async () => {
    const scope = scopeOf('t1');
    await runWithScope(scope, async () => {
      await Promise.resolve();
    });
    expect(getScope()).toBeUndefined();
  });

  it('bordes: dos runs concurrentes no se contaminan entre sí', async () => {
    const [a, b] = await Promise.all([
      runWithScope(scopeOf('tenant-a'), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return requireScope().tenantId;
      }),
      runWithScope(scopeOf('tenant-b'), async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return requireScope().tenantId;
      }),
    ]);
    expect([a, b]).toEqual(['tenant-a', 'tenant-b']);
  });

  it('bordes: un run anidado ve su propio alcance y el externo queda intacto', () => {
    runWithScope(scopeOf('outer'), () => {
      runWithScope(scopeOf('inner'), () => {
        expect(requireScope().tenantId).toBe('inner');
      });
      expect(requireScope().tenantId).toBe('outer');
    });
  });

  it('congela el alcance que recibe (no se puede ensanchar aguas abajo)', () => {
    const mutable = { tenantId: 't1', actor: { kind: 'user' as const, id: 'u1' } };
    runWithScope(mutable, () => {
      expect(Object.isFrozen(requireScope())).toBe(true);
      expect(() => {
        (requireScope() as { tenantId: string }).tenantId = 't2';
      }).toThrow();
    });
  });
});

describe('buildScope (inmutable, tenant plano, scope.md §3/§7)', () => {
  it('produce un objeto congelado, con la forma mínima {tenantId, actor}', () => {
    const scope = scopeOf('t1');
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.actor)).toBe(true);
    expect(Object.keys(scope).sort()).toEqual(['actor', 'tenantId']);
  });

  it('transporta el actor de token público sin roles ni permisos', () => {
    const scope = buildScope({ tenantId: 't1', actor: { kind: 'public-token', id: 'tok-1' } });
    expect(scope.actor).toEqual({ kind: 'public-token', id: 'tok-1' });
  });

  it('bordes: rechaza tenantId vacío, ausente o solo espacios', () => {
    expect(() => buildScope({ tenantId: '', actor: { kind: 'user', id: 'u1' } })).toThrow();
    expect(() => buildScope({ tenantId: '   ', actor: { kind: 'user', id: 'u1' } })).toThrow();
    expect(() =>
      buildScope({ tenantId: undefined as unknown as string, actor: { kind: 'user', id: 'u1' } }),
    ).toThrow();
  });

  it('bordes: rechaza un actor sin id o con un kind desconocido', () => {
    expect(() =>
      buildScope({ tenantId: 't1', actor: { kind: 'user', id: '' } }),
    ).toThrow();
    expect(() =>
      buildScope({
        tenantId: 't1',
        actor: { kind: 'robot', id: 'x' } as unknown as { kind: 'user'; id: string },
      }),
    ).toThrow();
  });
});

describe('ScopeMissingError', () => {
  it('es un Error identificable y con nombre propio', () => {
    const error = new ScopeMissingError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ScopeMissingError');
    expect(error.message.length).toBeGreaterThan(0);
  });
});