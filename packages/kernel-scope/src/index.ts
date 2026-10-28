/**
 * `@kernel/scope` — alcance del kernel (`docs/contracts/scope.md`).
 *
 * El **único** seam de resolución de alcance (D11, §5.3, ADR 0003): el borde
 * puebla el `ScopeContext` aquí y el repositorio lo consume. El puerto de dominio
 * **no** recibe el alcance (§4.1). TypeScript con solo core de Node
 * (`node:async_hooks`), sin frameworks.
 */
export { buildScope } from './build-scope.js';
export type { ScopeInput } from './build-scope.js';
export type { Actor, ScopeContext, TenantId, TokenId, UserId } from './scope-context.js';
export { ScopeMissingError } from './scope-errors.js';
export { getScope, runWithScope } from './scope-storage.js';
export { requireScope } from './require-scope.js';