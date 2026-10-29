/**
 * `@kernel/client` — cliente offline del kernel (`docs/kernel-context.md` §4).
 *
 * Cola offline, caché GET, flush y connectivity **parametrizados por puertos** y
 * **sin dominio adentro** (§1.2: el anti-patrón hardcodeaba el probe, las rutas
 * no encolables y un refresh key). Implementación de referencia del protocolo de
 * sync (D14): el núcleo no usa APIs de navegador.
 */
export { CacheError, QueuePreconditionError } from './errors.js';
export {
  GET_CACHE_MAX_ENTRIES,
  GET_CACHE_TTL_MS,
  GetCache,
} from './get-cache.js';
export type { GetCacheDependencies } from './get-cache.js';
export type { ConnectivityProbe, ProbeSpec } from './ports/connectivity.js';
export type { CachedGet, GetCacheStore } from './ports/get-cache-store.js';
export type { OfflinePolicy } from './ports/offline-policy.js';
export type { QueueStore } from './ports/queue-store.js';
export type { Scheduler, SchedulerHandle } from './ports/scheduler.js';
export type {
  HttpMethod,
  Transport,
  TransportNetworkError,
  TransportRequest,
  TransportResponse,
  TransportResult,
} from './ports/transport.js';
export {
  blockedReason,
  classifyResult,
  classifyStatusCode,
  markAttempt,
  markBlocked,
  markRequeued,
  markRetained,
} from './queue-state.js';
export type { SendOutcome } from './queue-state.js';
export { buildReplayHeaders } from './replay-headers.js';
export { SyncClient, WATCHDOG_MS } from './sync-client.js';
export type {
  EnqueueRequest,
  FlushOutcome,
  FlushOutcomeResult,
  FlushReason,
  FlushReport,
  SyncClientDependencies,
} from './sync-client.js';

export { InMemoryGetCacheStore } from './adapters/in-memory-get-cache-store.js';
export { InMemoryQueueStore } from './adapters/in-memory-queue-store.js';
export { ManualScheduler, TimeoutScheduler } from './adapters/schedulers.js';
export { TransportConnectivityProbe } from './adapters/transport-connectivity.js';
