import type { Clock, IdGenerator } from '@kernel/domain';

import { InMemoryGetCacheStore } from '../../src/adapters/in-memory-get-cache-store.js';
import { InMemoryQueueStore } from '../../src/adapters/in-memory-queue-store.js';
import { ManualScheduler } from '../../src/adapters/schedulers.js';
import type { ConnectivityProbe } from '../../src/ports/connectivity.js';
import type { OfflinePolicy } from '../../src/ports/offline-policy.js';
import type { Transport, TransportRequest, TransportResult } from '../../src/ports/transport.js';
import { SyncClient } from '../../src/sync-client.js';

/** Reloj determinista con avance manual. */
export class FixedClock implements Clock {
  #value: Date;

  constructor(start: Date) {
    this.#value = start;
  }

  now(): Date {
    return this.#value;
  }

  advance(ms: number): void {
    this.#value = new Date(this.#value.getTime() + ms);
  }
}

/** Generador de IDs determinista para los tests (`id-1`, `id-2`, …). */
export class SequenceIdGenerator implements IdGenerator {
  #n = 0;

  next(): string {
    this.#n += 1;
    return `id-${this.#n}`;
  }
}

/** Transporte con respuesta programada por el test; registra las requests. */
export class StubTransport implements Transport {
  readonly requests: TransportRequest[] = [];

  constructor(
    private readonly responder: (
      request: TransportRequest,
      call: number,
    ) => Promise<TransportResult> | TransportResult,
  ) {}

  async send(request: TransportRequest): Promise<TransportResult> {
    this.requests.push(request);
    return this.responder(request, this.requests.length);
  }
}

export function response(statusCode: number, body: unknown): TransportResult {
  return { kind: 'response', statusCode, body };
}

export function networkError(error?: unknown): TransportResult {
  return error === undefined ? { kind: 'network-error' } : { kind: 'network-error', error };
}

/** Envelope exitoso del kernel, para armar bodies en los tests. */
export function envelope<T>(data: T, statusCode = 200): unknown {
  return { statusCode, data, timestamp: '2026-10-29T12:00:00.000Z' };
}

/** Envelope de error del kernel (`{statusCode, message, error, timestamp}`). */
export function errorEnvelope(statusCode: number, message: string, error: string | null): unknown {
  return { statusCode, message, error, timestamp: '2026-10-29T12:00:00.000Z' };
}

/** Cede el control para que el flush registre su watchdog antes de vencerlo. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export interface HarnessOptions {
  readonly transport?: StubTransport;
  readonly watchdogMs?: number;
  readonly policy?: OfflinePolicy;
  readonly connectivity?: ConnectivityProbe;
  readonly queue?: InMemoryQueueStore;
  readonly getCache?: {
    readonly store?: InMemoryGetCacheStore;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
  };
}

export interface Harness {
  readonly client: SyncClient;
  readonly transport: StubTransport;
  readonly scheduler: ManualScheduler;
  readonly clock: FixedClock;
  readonly queue: InMemoryQueueStore;
  readonly cacheStore: InMemoryGetCacheStore;
}

/** Cliente armado con adaptadores en memoria, sobreescribibles por el test. */
export function makeHarness(options: HarnessOptions = {}): Harness {
  const clock = new FixedClock(new Date('2026-10-29T12:00:00.000Z'));
  const transport = options.transport ?? new StubTransport(() => response(200, envelope({ ok: true })));
  const scheduler = new ManualScheduler();
  const queue = options.queue ?? new InMemoryQueueStore();
  const cacheStore = options.getCache?.store ?? new InMemoryGetCacheStore();

  const client = new SyncClient({
    clock,
    idGenerator: new SequenceIdGenerator(),
    queue,
    transport,
    scheduler,
    getCache: {
      store: cacheStore,
      ...(options.getCache?.ttlMs === undefined ? {} : { ttlMs: options.getCache.ttlMs }),
      ...(options.getCache?.maxEntries === undefined ? {} : { maxEntries: options.getCache.maxEntries }),
    },
    ...(options.connectivity === undefined ? {} : { connectivity: options.connectivity }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.watchdogMs === undefined ? {} : { watchdogMs: options.watchdogMs }),
  });

  return { client, transport, scheduler, clock, queue, cacheStore };
}
