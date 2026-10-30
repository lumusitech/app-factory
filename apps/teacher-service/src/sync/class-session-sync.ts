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

import type { AttendanceStatus } from '../domain/class-attendance.js';
import type { TrajectoryRating } from '../domain/trajectory-assessment.js';
import { classSessionOfflinePolicy } from './offline-policy.js';

/**
 * Captura offline de clase, calificaciones y valoración (F-01/F-02/F-03) sobre
 * `@kernel/client`
 * (`docs/kernel-context.md` §4; `docs/teacher-service-context.md` T10/§8).
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

/** Captura de un tema del plan (`POST /courses/:courseId/topics`). */
export interface TopicCapture {
  readonly courseId: string;
  readonly order: number;
  readonly content: string;
  /** Id opcional (UUIDv7, D8) para crear y vincular offline en la misma sesión. */
  readonly id?: string;
  readonly idempotencyKey?: string;
}

/** Captura del tema dictado (`PUT /class-sessions/:id/topic`). */
export interface ClassTopicCapture {
  readonly classSessionId: string;
  readonly topicId: string;
  /** Token opaco de versión vigente (ADR 0011); sin él, no versiona. */
  readonly baseVersion?: string;
  readonly idempotencyKey?: string;
}

/** Captura de la asistencia de la clase (`PUT /class-sessions/:id/attendance`). */
export interface AttendanceCapture {
  readonly classSessionId: string;
  readonly entries: ReadonlyArray<{
    readonly studentId: string;
    readonly status: AttendanceStatus;
  }>;
  readonly baseVersion?: string;
  readonly idempotencyKey?: string;
}

/** Captura de una tarea (`POST /class-sessions/:id/assignments`). */
export interface AssignmentCapture {
  readonly classSessionId: string;
  readonly content: string;
  readonly topicId?: string;
  readonly idempotencyKey?: string;
}

/** Captura de una evaluación del curso (`POST /courses/:courseId/evaluations`; F-02). */
export interface EvaluationCapture {
  readonly courseId: string;
  readonly name: string;
  readonly period: string;
  readonly weight: number;
  /** Id opcional (UUIDv7, D8) para crear la evaluación y calificar offline en la misma sesión. */
  readonly id?: string;
  readonly idempotencyKey?: string;
}

/** Captura de las notas de una evaluación (`PUT /evaluations/:id/grades`; F-02). */
export interface GradesCapture {
  readonly evaluationId: string;
  readonly entries: ReadonlyArray<{
    readonly studentId: string;
    readonly value: number;
  }>;
  /** Token opaco de versión vigente (ADR 0012); sin él, no versiona. */
  readonly baseVersion?: string;
  readonly idempotencyKey?: string;
}

/** Captura de la valoración preliminar de un curso/período (F-03). */
export interface TrajectoryAssessmentCapture {
  readonly courseId: string;
  readonly period: string;
  readonly entries: ReadonlyArray<{
    readonly studentId: string;
    readonly rating: TrajectoryRating;
  }>;
  /** Token opaco de versión vigente (ADR 0013); sin él, no versiona. */
  readonly baseVersion?: string;
  readonly idempotencyKey?: string;
}

/** Captura de una entrada del registro del alumno (`POST /students/:studentId/records`; F-05). */
export interface StudentRecordCapture {
  readonly studentId: string;
  readonly kind: 'observacion' | 'movimiento' | 'evaluacion';
  readonly occurredOn: string;
  readonly note?: string;
  readonly category?: string;
  readonly evaluationId?: string;
  readonly grade?: number;
  /** Id opcional (UUIDv7, D8) para capturar offline. */
  readonly id?: string;
  readonly idempotencyKey?: string;
}

/**
 * Fachada de captura offline: traduce las operaciones de escritura (clase,
 * evaluación, notas) a items de la cola, poblando `Idempotency-Key` y el token
 * `baseVersion` (`String(version)`, ADR 0010/0012). El kernel hace el resto
 * (flush FIFO, watchdog, conflicto `lww`, replay idempotente).
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

  /** Captura la creación de un tema del plan (`POST /courses/:courseId/topics`). */
  async captureTopic(input: TopicCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'POST',
      path: `/courses/${input.courseId}/topics`,
      body: {
        order: input.order,
        content: input.content,
        ...(input.id === undefined ? {} : { id: input.id }),
      },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
    });
  }

  /** Captura el tema dictado de una clase (`PUT /class-sessions/:id/topic`). */
  async captureClassTopic(input: ClassTopicCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'PUT',
      path: `${CLASS_SESSION_PATH}/${input.classSessionId}/topic`,
      body: { topicId: input.topicId },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
      baseVersion: input.baseVersion ?? null,
    });
  }

  /** Captura la asistencia de una clase (`PUT /class-sessions/:id/attendance`). */
  async captureAttendance(input: AttendanceCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'PUT',
      path: `${CLASS_SESSION_PATH}/${input.classSessionId}/attendance`,
      body: { entries: input.entries },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
      baseVersion: input.baseVersion ?? null,
    });
  }

  /** Captura una tarea de la clase (`POST /class-sessions/:id/assignments`). */
  async captureAssignment(input: AssignmentCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'POST',
      path: `${CLASS_SESSION_PATH}/${input.classSessionId}/assignments`,
      body: {
        content: input.content,
        ...(input.topicId === undefined ? {} : { topicId: input.topicId }),
      },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
    });
  }

  /** Captura la creación de una evaluación (`POST /courses/:courseId/evaluations`). */
  async captureEvaluation(input: EvaluationCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'POST',
      path: `/courses/${input.courseId}/evaluations`,
      body: {
        name: input.name,
        period: input.period,
        weight: input.weight,
        ...(input.id === undefined ? {} : { id: input.id }),
      },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
    });
  }

  /** Captura las notas de una evaluación (`PUT /evaluations/:id/grades`). */
  async captureGrades(input: GradesCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'PUT',
      path: `/evaluations/${input.evaluationId}/grades`,
      body: { entries: input.entries },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
      baseVersion: input.baseVersion ?? null,
    });
  }

  /** Captura la valoración preliminar de un curso/período (`PUT /courses/:courseId/trajectory-assessments/:period`). */
  async captureTrajectoryAssessment(input: TrajectoryAssessmentCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'PUT',
      path: `/courses/${input.courseId}/trajectory-assessments/${input.period}`,
      body: { entries: input.entries },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
      baseVersion: input.baseVersion ?? null,
    });
  }

  /** Captura una entrada del registro del alumno (`POST /students/:studentId/records`; F-05). */
  async captureStudentRecord(input: StudentRecordCapture): Promise<QueuedRequest> {
    return this.#client.enqueue({
      method: 'POST',
      path: `/students/${input.studentId}/records`,
      body: {
        kind: input.kind,
        occurredOn: input.occurredOn,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.evaluationId === undefined ? {} : { evaluationId: input.evaluationId }),
        ...(input.grade === undefined ? {} : { grade: input.grade }),
        ...(input.id === undefined ? {} : { id: input.id }),
      },
      idempotencyKey: this.#idempotencyKey(input.idempotencyKey),
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
