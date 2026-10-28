/**
 * Catálogo de códigos de error del kernel.
 *
 * Los contratos delegan acá los nombres concretos de los códigos
 * (`docs/contracts/idempotency.md` §10, `docs/contracts/sync.md` §9). El
 * catálogo es mínimo y crece con consumidores reales (ODD #1). Decisiones y
 * disparador de ampliación: ADR 0005.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  /** Dos requests con la misma `Idempotency-Key`: en vuelo o con payload distinto (idempotency §6, §7). */
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  /** Escritura obsoleta bajo política `blocked` (sync §8.2). */
  SYNC_VERSION_CONFLICT: 'SYNC_VERSION_CONFLICT',
  /** Consulta de datos de tenant sin alcance activo (scope §6.2). */
  SCOPE_MISSING: 'SCOPE_MISSING',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Status HTTP asociado a cada código de error. */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  SYNC_VERSION_CONFLICT: 409,
  SCOPE_MISSING: 500,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

const ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(ERROR_CODES));

/** Verifica, en el borde, si un valor arbitrario es un código del catálogo. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_VALUES.has(value);
}
