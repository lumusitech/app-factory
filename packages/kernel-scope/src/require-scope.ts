import { ScopeMissingError } from './scope-errors.js';
import type { ScopeContext } from './scope-context.js';
import { getScope } from './scope-storage.js';

/**
 * Devuelve el `ScopeContext` activo o **lanza** `ScopeMissingError` (fail-closed,
 * scope.md §6.2).
 *
 * Es la única puerta por la que el adaptador obtiene el tenant: **no existe** una
 * variante de la API que omita el alcance. La garantía es estructural, no una
 * convención de estilo.
 */
export function requireScope(): ScopeContext {
  const scope = getScope();
  if (scope === undefined) {
    throw new ScopeMissingError();
  }
  return scope;
}