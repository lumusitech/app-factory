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
export { CONNECTIVITY_PROBE_VALUE, HEADERS, isConnectivityProbe } from './headers.js';
export type {
  QueuedRequest,
  QueuedRequestBlockedReason,
  QueuedRequestMethod,
  QueuedRequestState,
} from './queued-request.js';
