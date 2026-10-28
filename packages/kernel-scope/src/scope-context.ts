/**
 * Alcance (`ScopeContext`) del kernel — `docs/contracts/scope.md` §3.
 *
 * Forma mínima y normativa: `tenantId` plano y obligatorio (D25) + `actor`.
 * No transporta el catálogo de roles ni permisos: eso es de la vertical (§1.4).
 * El kernel **no interpreta** el formato de los identificadores: son opacos.
 */

/** Identificador opaco de tenant. Plano: sin jerarquía (D25). */
export type TenantId = string;

/** Identificador de un usuario autenticado dentro de un tenant. */
export type UserId = string;

/** Identificador de un token público (acceso anónimo acotado a un tenant, T9). */
export type TokenId = string;

/** Quien ejecuta la request: un usuario o un token público (scope.md §3). */
export type Actor =
  | { readonly kind: 'user'; readonly id: UserId }
  | { readonly kind: 'public-token'; readonly id: TokenId };

/** Estructura inmutable con el alcance de la request. */
export interface ScopeContext {
  readonly tenantId: TenantId;
  readonly actor: Actor;
}