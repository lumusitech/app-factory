import { SyncClient, TransportConnectivityProbe } from '@kernel/client';
import type {
  ConnectivityProbe,
  GetCacheStore,
  ProbeSpec,
  QueueStore,
  Scheduler,
  Transport,
} from '@kernel/client';
import type { QueuedRequest } from '@kernel/contracts';
import type { Clock, IdGenerator } from '@kernel/domain';

import { classSessionOfflinePolicy } from './offline-policy.js';

/**
 * Captura offline de clase (F-01) sobre `@kernel/client` (`docs/kernel-context.md`
 * §4; `docs/teacher-service-context.md` T10/§8).
 *
 * El cliente es **parametrizado por puertos** y **sin APIs de navegador** (D4,
 * ADR 0008). Los adaptadores concretos —memoria en test; el de IndexedDB está
 * diferido (ADR 0008 §2)— los inyecta el borde; acá solo se fija lo que decide
 * la vertical: la política offline y el endpoint de probe.
 */

/** Endpoint de probe de la vertical (sync §6); el núcleo no lo conoce. */
export const CLASS_SESSION_PROBE_SPEC: ProbeSpec = { path: '/probe' };

const CLASS_SESSION_PATH = '/class-sessions';

export interface ClassSessionSyncPorts {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly queue: QueueStore;
  readonly transport: Transport;
  readonly scheduler: Scheduler;
  /** Habilita la caché de lectura (§1.1). Sin ella, `get()` no está disponible. */
  readonly getCache?: {
    readonly store: GetCacheStore;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
  };
  /** Conectividad; por defecto, un probe contra `CLASS_SESSION_PROBE_SPEC`. */
  readonly connectivity?: ConnectivityProbe;
  /** Watchdog del intento; por defecto, 20 s (sync §5.2). */
  readonly watchdogMs?: number;
}

export interface ClassSessionCreateCapture {
  readonly courseId: string;
  readonly date: string;
  /** Clave de la operación lógica; por defecto, un UUIDv7 nuevo (sync §1). */
  readonly idempotencyKey?: string;
}

/** Transición capturable: `cancelada` exige motivo; `feriado`/`sin_clase` no. */
export type ClassSessionTransitionCapture =
  | {
      readonly id: string;
      readonly status: 'cancelada';
      readonly cancellationReason: string;
      /** Token opaco de versión vigente (ADR 0010); sin él, no versiona. */
      readonly baseVersion?: string;
      readonly idempotencyKey?: string;
    }
  | {
      readonly id: string;
      readonly status: 'feriado' | 'sin_clase';
      readonly baseVersion?: string;
      readonly idempotencyKey?: string;
    };

/**
 * Fachada de captura offline: traduce las operaciones de escritura de la clase
 * a items de la cola, poblando `Idempotency-Key` y el token `baseVersion`
 * (`String(version)`, ADR 0010). El kernel hace el resto (flush FIFO, watchdog,
 * conflicto `lww`, replay idempotente).
 */
export class ClassSessionSync {
  readonly #client: SyncClient;
  readonly #idGenerator: IdGenerator;

  constructor(client: SyncClient, idGenerator: IdGenerator) {
    this.#client = client;
    this.#idGenerator = idGenerator;
  }

  /** El `SyncClient` subyacente: cola, flush, caché de lectura y probe. */
  get client(): SyncClient {
    return this.#client;
  }

  /** Captura la creación de una clase (`POST /class-sessions`). */
  async captureCreate(input: ClassSessionCreateCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'POST',
      path: CLASS_SESSION_PATH,
      body: { courseId: input.courseId, date: input.date },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
    });
  }

  /** Captura una transición de estado (`PATCH /class-sessions/:id`). */
  async captureTransition(input: ClassSessionTransitionCapture): Promise<QueuedRequest> {
    const body =
      input.status === 'cancelada'
        ? { status: 'cancelada', cancellationReason: input.cancellationReason }
        : { status: input.status };

    return this.#client.enqueue({
      method: 'PATCH',
      path: `${CLASS_SESSION_PATH}/${input.id}`,
      body,
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
      baseVersion: input.baseVersion ?? null,
    });
  }

  #idempotencyKey(provided: string | undefined): string {
    return provided ?? this.#idGenerator.next();
  }
}

/**
 * Composition root del cliente offline de la vertical (D4): arma el `SyncClient`
 * con la política y el probe de `teacher-service` sobre los puertos inyectados.
 */
export function createClassSessionSync(ports: ClassSessionSyncPorts): ClassSessionSync {
  const client = new SyncClient({
    clock: ports.clock,
    idGenerator: ports.idGenerator,
    queue: ports.queue,
    transport: ports.transport,
    scheduler: ports.scheduler,
    ...(ports.getCache === undefined ? {} : { getCache: ports.getCache }),
    connectivity:
      ports.connectivity ??
      new TransportConnectivityProbe(ports.transport, CLASS_SESSION_PROBE_SPEC),
    policy: classSessionOfflinePolicy,
    ...(ports.watchdogMs === undefined ? {} : { watchdogMs: ports.watchdogMs }),
  });

  return new ClassSessionSync(client, ports.idGenerator);
}
