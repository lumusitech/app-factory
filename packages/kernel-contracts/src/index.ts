/**
 * `@kernel/contracts` — contratos de transporte del kernel.
 *
 * Solo envelope, headers, códigos de error y schemas de protocolo. **No** exporta
 * tipos de entidad (`docs/kernel-context.md` §8): el contrato OpenAPI tiene una
 * única fuente de verdad.
 */
export type { Envelope, ErrorEnvelope } from './envelope.js';
export type { ErrorCode } from './error-codes.js';
export { ERROR_CODES, ERROR_STATUS, isErrorCode } from './error-codes.js';
export type { HeaderName } from './headers.js';
export {
  CONNECTIVITY_PROBE_VALUE,
  HEADERS,
  OFFLINE_REPLAY_VALUE,
  isConnectivityProbe,
} from './headers.js';
export type { IdempotencyRecord, IdempotencyStore } from './idempotency.js';
export { IDEMPOTENCY_TTL_HOURS, idempotencyExpiry } from './idempotency.js';
export type {
  QueuedRequest,
  QueuedRequestBlockedReason,
  QueuedRequestMethod,
  QueuedRequestState,
} from './queued-request.js';
export type { OverwriteSignal, SyncPolicy } from './sync.js';
export { DEFAULT_SYNC_POLICY, parseOverwriteSignal } from './sync.js';
