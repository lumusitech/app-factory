/**
 * Tipo espejo del schema normativo `schemas/queued-request.schema.json`
 * (`docs/contracts/sync.md` §7). La forma normativa es el schema; este tipo es
 * la comodidad de TypeScript para quien lo consume desde el mismo monorepo.
 */
export type QueuedRequestMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueuedRequestState = 'pending' | 'blocked';

/** Motivo del bloqueo. No null si y solo si `state = 'blocked'`. */
export interface QueuedRequestBlockedReason {
  readonly statusCode: number;
  readonly message: string;
  readonly error?: string | null;
}

/**
 * Unidad de la cola offline del cliente (sync §7). `state = 'blocked'` es
 * terminal-visible: nunca se descarta en silencio.
 */
export interface QueuedRequest {
  /** Identificador local del item (UUIDv7). */
  readonly id: string;
  /** Secuencia FIFO de encolado, estrictamente creciente dentro de un cliente. */
  readonly order: number;
  readonly method: QueuedRequestMethod;
  /** Ruta enrutada de destino, sin query string. */
  readonly path: string;
  /** Cuerpo de la request; `null` cuando la mutación no lleva cuerpo. */
  readonly body?: Record<string, unknown> | null;
  /** Valor del header `Idempotency-Key`. Único por operación lógica. */
  readonly idempotencyKey: string;
  /** Token de versión de la entidad al capturar (sync §8); `null` si no versiona. */
  readonly baseVersion?: string | null;
  readonly state: QueuedRequestState;
  /** Instante de encolado, ISO 8601. */
  readonly createdAt: string;
  readonly attempts: number;
  /** Instante del último intento, o `null` si nunca se intentó. */
  readonly lastAttemptAt?: string | null;
  readonly blockedReason?: QueuedRequestBlockedReason | null;
}
