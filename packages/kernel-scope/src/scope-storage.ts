import { AsyncLocalStorage } from 'node:async_hooks';

import { freezeScope } from './build-scope.js';
import type { ScopeContext } from './scope-context.js';

/**
 * El `AsyncLocalStorage` del alcance. Es el **único** del monorepo: la frontera
 * `scope-resolution-only-in-kernel-scope` (ADR 0006) prohíbe `async_hooks` fuera
 * de este paquete, de modo que la resolución de alcance no se puede reimplementar
 * (scope.md §8, D11).
 */
const storage = new AsyncLocalStorage<ScopeContext>();

/** El `ScopeContext` activo, o `undefined` si no hay alcance poblado. */
export function getScope(): ScopeContext | undefined {
  return storage.getStore();
}

/**
 * Ejecuta `fn` dentro del alcance `scope`, propagándolo por todo el pipeline
 * (incluidos los `await`). Congela el alcance antes de entrar: no se ensancha ni
 * se reemplaza a mitad de request (scope.md §3/§4).
 */
export function runWithScope<TResult>(scope: ScopeContext, fn: () => TResult): TResult {
  return storage.run(freezeScope(scope), fn);
}