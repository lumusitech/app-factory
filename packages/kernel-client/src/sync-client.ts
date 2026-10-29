import type { OverwriteSignal, QueuedRequest, QueuedRequestMethod } from '@kernel/contracts';
import { parseOverwriteSignal } from '@kernel/contracts';
import type { Clock, IdGenerator } from '@kernel/domain';

import { CacheError, QueuePreconditionError } from './errors.js';
import { GetCache } from './get-cache.js';
import type { GetCacheStore } from './ports/get-cache-store.js';
import type { ConnectivityProbe } from './ports/connectivity.js';
import type { OfflinePolicy } from './ports/offline-policy.js';
import type { QueueStore } from './ports/queue-store.js';
import type { Scheduler } from './ports/scheduler.js';
import type { Transport, TransportRequest, TransportResult } from './ports/transport.js';
import { markBlocked, markRequeued, markRetained, classifyStatusCode } from './queue-state.js';
import { buildReplayHeaders } from './replay-headers.js';

/** Watchdog de un intento (sync §5.2): 20 s. No se re-litiga. */
export const WATCHDOG_MS = 20_000;

const MUTATIONS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Entrada de `enqueue` (sync §1). La `Idempotency-Key` la elige el llamador. */
export interface EnqueueRequest {
  readonly method: QueuedRequestMethod;
  readonly path: string;
  readonly body?: Record<string, unknown> | null;
  readonly idempotencyKey: string;
  readonly baseVersion?: string | null;
}

export type FlushOutcomeResult = 'removed' | 'blocked' | 'retained' | 'not-attempted';
export type FlushReason = 'http' | 'network' | 'watchdog';

/** Resultado de un item en un ciclo de flush. */
export interface FlushOutcome {
  readonly id: string;
  readonly order: number;
  readonly result: FlushOutcomeResult;
  readonly statusCode?: number;
  readonly reason?: FlushReason;
  /** Señal de sobrescritura de `lww` (sync §8.2), si la hubo. */
  readonly overwritten?: OverwriteSignal;
}

/** Reporte del flush: qué pasó con cada item y si el ciclo se cortó (§5.1). */
export interface FlushReport {
  readonly attempted: number;
  readonly cut: boolean;
  readonly outcomes: readonly FlushOutcome[];
}

export interface SyncClientDependencies {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly queue: QueueStore;
  readonly transport: Transport;
  readonly scheduler: Scheduler;
  /** Configura la caché GET; sin ella, `get()` no está disponible. */
  readonly getCache?: {
    readonly store: GetCacheStore;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
  };
  /** Conectividad parametrizada (§4); sin ella, `probe()` devuelve `true`. */
  readonly connectivity?: ConnectivityProbe;
  /** Política del motor offline, sin dominio adentro (§1.2). */
  readonly policy?: OfflinePolicy;
  /** Watchdog del intento; por defecto 20 s (sync §5.2). */
  readonly watchdogMs?: number;
}

/**
 * Cliente offline del kernel (§4, §1.1): cola con estados `pending`/`blocked`,
 * flush FIFO con watchdog, caché GET y connectivity. **Parametrizado por puertos**
 * y **sin dominio adentro** (§1.2): no conoce el endpoint de probe, ni las rutas
 * no encolables, ni ningún refresh key de la vertical.
 */
export class SyncClient {
  readonly #clock: Clock;
  readonly #idGenerator: IdGenerator;
  readonly #queue: QueueStore;
  readonly #transport: Transport;
  readonly #scheduler: Scheduler;
  readonly #watchdogMs: number;
  readonly #connectivity: ConnectivityProbe | undefined;
  readonly #policy: OfflinePolicy | undefined;
  readonly #getCache: GetCache | undefined;

  constructor(dependencies: SyncClientDependencies) {
    this.#clock = dependencies.clock;
    this.#idGenerator = dependencies.idGenerator;
    this.#queue = dependencies.queue;
    this.#transport = dependencies.transport;
    this.#scheduler = dependencies.scheduler;
    this.#watchdogMs = dependencies.watchdogMs ?? WATCHDOG_MS;
    this.#connectivity = dependencies.connectivity;
    this.#policy = dependencies.policy;

    const cache = dependencies.getCache;
    this.#getCache =
      cache === undefined
        ? undefined
        : new GetCache({
            clock: dependencies.clock,
            transport: dependencies.transport,
            store: cache.store,
            ...(cache.ttlMs === undefined ? {} : { ttlMs: cache.ttlMs }),
            ...(cache.maxEntries === undefined ? {} : { maxEntries: cache.maxEntries }),
          });
  }

  /**
   * Encola una mutación capturada offline (sync §1). **Fail-closed**: rechaza
   * todo lo que no cumpla la precondición —no mutación, sin `Idempotency-Key`, o
   * ruta declarada no encolable por la política.
   */
  async enqueue(request: EnqueueRequest): Promise<QueuedRequest> {
    if (!MUTATIONS.has(request.method)) {
      throw new QueuePreconditionError(
        `Solo las mutaciones se encolan; se recibió ${request.method} (sync §1).`,
      );
    }
    if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.trim() === '') {
      throw new QueuePreconditionError(
        'Una request se encola si y solo si trae una Idempotency-Key (sync §1).',
      );
    }
    if (
      this.#policy?.isQueueable !== undefined &&
      !this.#policy.isQueueable(request.method, request.path)
    ) {
      throw new QueuePreconditionError(`La ruta ${request.path} no es encolable (política).`);
    }

    const items = await this.#queue.list();
    const last = items[items.length - 1];
    const order = last === undefined ? 0 : last.order + 1;

    const item: QueuedRequest = {
      id: this.#idGenerator.next(),
      order,
      method: request.method,
      path: request.path,
      body: request.body ?? null,
      idempotencyKey: request.idempotencyKey,
      baseVersion: request.baseVersion ?? null,
      state: 'pending',
      createdAt: this.#clock.now().toISOString(),
      attempts: 0,
      lastAttemptAt: null,
      blockedReason: null,
    };

    await this.#queue.add(item);
    return item;
  }

  /** La cola completa, en orden FIFO (para la UI). */
  async list(): Promise<readonly QueuedRequest[]> {
    return this.#queue.list();
  }

  /** Reencola un item `blocked` tras la intervención humana (sync §3). */
  async requeue(id: string): Promise<void> {
    const items = await this.#queue.list();
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined || item.state !== 'blocked') {
      return;
    }
    await this.#queue.update(markRequeued(item));
  }

  /**
   * Recorre la cola en orden FIFO y envía **un item a la vez** (sync §5). Corta
   * el ciclo ante `5xx`/red/watchdog (conservando el item) y ante un item
   * `blocked` (head-of-line). Devuelve qué pasó con cada item.
   */
  async flush(): Promise<FlushReport> {
    const items = await this.#queue.list();
    const outcomes: FlushOutcome[] = [];
    let cut = false;

    for (const item of items) {
      if (item.state === 'blocked') {
        // Head-of-line: un `blocked` detiene el procesamiento automático (§5.1).
        outcomes.push({ id: item.id, order: item.order, result: 'not-attempted' });
        cut = true;
        break;
      }

      const attempt = await this.#send(item);
      const nowIso = this.#clock.now().toISOString();

      if (attempt.kind === 'watchdog') {
        await this.#queue.update(markRetained(item, nowIso));
        outcomes.push({ id: item.id, order: item.order, result: 'retained', reason: 'watchdog' });
        cut = true;
        break;
      }
      if (attempt.kind === 'network-error') {
        await this.#queue.update(markRetained(item, nowIso));
        outcomes.push({ id: item.id, order: item.order, result: 'retained', reason: 'network' });
        cut = true;
        break;
      }

      const outcome = classifyStatusCode(attempt.statusCode, attempt.body);

      if (outcome.kind === 'applied') {
        await this.#queue.remove(item.id);
        const overwritten = parseOverwriteSignal(attempt.body);
        outcomes.push({
          id: item.id,
          order: item.order,
          result: 'removed',
          statusCode: attempt.statusCode,
          ...(overwritten === null ? {} : { overwritten }),
        });
        continue;
      }

      if (outcome.kind === 'blocked') {
        await this.#queue.update(markBlocked(item, nowIso, outcome.reason));
        outcomes.push({
          id: item.id,
          order: item.order,
          result: 'blocked',
          statusCode: attempt.statusCode,
          reason: 'http',
        });
        // El item quedó `blocked` en la cabeza → corta (head-of-line, §5.1).
        cut = true;
        break;
      }

      // `retained` (5xx): conservar y cortar (§4).
      await this.#queue.update(markRetained(item, nowIso));
      outcomes.push({
        id: item.id,
        order: item.order,
        result: 'retained',
        statusCode: attempt.statusCode,
        reason: 'http',
      });
      cut = true;
      break;
    }

    return {
      attempted: outcomes.filter((outcome) => outcome.result !== 'not-attempted').length,
      cut,
      outcomes,
    };
  }

  /**
   * Conectividad (parametrizada, §4). Decide **cuándo** disparar el flush; el
   * resultado no crea ni modifica items (sync §6). Sin puerto, asume online.
   */
  async probe(): Promise<boolean> {
    return this.#connectivity === undefined ? true : this.#connectivity.check();
  }

  /** Lectura con caché GET (§1.1). Requiere haber configurado `getCache`. */
  async get<T>(key: string, path: string): Promise<T> {
    if (this.#getCache === undefined) {
      throw new CacheError('La caché GET no está configurada en este cliente.');
    }
    return this.#getCache.read<T>(key, path);
  }

  async #send(item: QueuedRequest): Promise<TransportResult | { readonly kind: 'watchdog' }> {
    const request: TransportRequest = {
      method: item.method,
      path: item.path,
      headers: buildReplayHeaders(item),
      body: item.body ?? null,
    };
    return this.#withWatchdog(this.#transport.send(request));
  }

  /** Acota un intento con el watchdog (§5.2). Al vencer, se conserva el item. */
  #withWatchdog(
    attempt: Promise<TransportResult>,
  ): Promise<TransportResult | { readonly kind: 'watchdog' }> {
    return new Promise((resolve) => {
      let settled = false;
      const handle = this.#scheduler.schedule(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ kind: 'watchdog' });
      }, this.#watchdogMs);

      attempt.then(
        (result) => {
          if (settled) {
            return;
          }
          settled = true;
          handle.cancel();
          resolve(result);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          handle.cancel();
          resolve({ kind: 'network-error', error });
        },
      );
    });
  }
}
