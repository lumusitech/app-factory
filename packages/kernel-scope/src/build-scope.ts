import type { Actor, ScopeContext, TenantId } from './scope-context.js';

/** Entrada para poblar el alcance en el borde (scope.md §4). */
export interface ScopeInput {
  readonly tenantId: TenantId;
  readonly actor: Actor;
}

function isActor(value: unknown): value is Actor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (typeof id !== 'string' || id.trim() === '') {
    return false;
  }
  return kind === 'user' || kind === 'public-token';
}

/**
 * Congela (idempotente) el alcance y su actor: aguas abajo solo se lee, nunca se
 * muta (scope.md §3). Si ya está congelado, devuelve la **misma** referencia.
 */
export function freezeScope(scope: ScopeContext): ScopeContext {
  if (Object.isFrozen(scope) && Object.isFrozen(scope.actor)) {
    return scope;
  }
  return Object.freeze({
    tenantId: scope.tenantId,
    actor: Object.freeze({ kind: scope.actor.kind, id: scope.actor.id }) as Actor,
  });
}

/**
 * Construye el `ScopeContext` inmutable a partir de la identidad resuelta.
 *
 * Es la **única** forma de materializar alcance (scope.md §8): el borde la llama
 * una vez; el resto del pipeline solo lee. Valida el borde: `tenantId` no vacío y
 * un `actor` con `kind` conocido e `id` no vacío.
 */
export function buildScope(input: ScopeInput): ScopeContext {
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : '';
  if (tenantId === '') {
    throw new TypeError(
      'ScopeContext.tenantId es obligatorio: el tenant es plano y nunca vacío (D25).',
    );
  }
  if (!isActor(input.actor)) {
    throw new TypeError(
      'ScopeContext.actor es obligatorio: { kind: "user" | "public-token", id } (scope.md §3).',
    );
  }
  return freezeScope({ tenantId, actor: input.actor });
}