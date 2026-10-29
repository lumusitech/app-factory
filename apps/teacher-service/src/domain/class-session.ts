import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Clase` — agregado del corte delgado de `teacher-service`
 * (`docs/teacher-service-context.md` §3.1/§3.4; ADR 0010).
 *
 * Invariantes:
 * - `status` ∈ {`dictada`, `cancelada`, `feriado`, `sin_clase`};
 * - `cancelada` ⟺ `cancellationReason` no vacío;
 * - `version` monótona (`String(version)` es el token de sync opaco, ADR 0010);
 * - re-marcar al **mismo** estado es **no-op** (sin evento ni incremento).
 *
 * El estado es **mutable** entre los cuatro valores: lo exige la política `lww`
 * (mono-escritor, T10), donde una escritura obsoleta debe poder aplicarse.
 */

export const CLASS_STATUSES = ['dictada', 'cancelada', 'feriado', 'sin_clase'] as const;

export type ClassStatus = (typeof CLASS_STATUSES)[number];

export const COURSE_ID_MAX_LENGTH = 200;
export const CANCELLATION_REASON_MAX_LENGTH = 200;

/** Fecha de calendario ISO `YYYY-MM-DD` (no un instante). */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ClassSessionSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly courseId: string;
  readonly date: string;
  readonly status: ClassStatus;
  readonly cancellationReason: string | null;
  readonly version: number;
}

export interface ClassSessionCreateInput {
  readonly tenantId: TenantId;
  readonly courseId: unknown;
  readonly date: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export interface ClassSessionTransitionInput {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export interface ClassSessionCancelInput extends ClassSessionTransitionInput {
  readonly reason: unknown;
}

/** `true` si `value` es una fecha de calendario real en formato `YYYY-MM-DD`. */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeCourseId(value: unknown): string {
  const courseId = typeof value === 'string' ? value.trim() : '';
  if (courseId === '' || courseId.length > COURSE_ID_MAX_LENGTH) {
    throw new Error(
      `El \`courseId\` debe ser un texto no vacío de hasta ${COURSE_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return courseId;
}

function normalizeCalendarDate(value: unknown): string {
  if (!isValidCalendarDate(value)) {
    throw new Error('La fecha de la clase debe ser una fecha de calendario válida (YYYY-MM-DD).');
  }
  return value;
}

function normalizeCancellationReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason === '' || reason.length > CANCELLATION_REASON_MAX_LENGTH) {
    throw new Error(
      `El motivo de cancelación debe ser un texto no vacío de hasta ${CANCELLATION_REASON_MAX_LENGTH} caracteres.`,
    );
  }
  return reason;
}

function assertStatus(value: unknown): asserts value is ClassStatus {
  if (typeof value !== 'string' || !(CLASS_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`Estado de clase inválido: "${String(value)}".`);
  }
}

function assertConsistent(status: ClassStatus, reason: string | null): void {
  if (status === 'cancelada' && reason === null) {
    throw new Error('Una clase cancelada requiere un motivo.');
  }
  if (status !== 'cancelada' && reason !== null) {
    throw new Error('Solo una clase cancelada puede tener motivo.');
  }
}

export class ClassSession {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: TenantId,
    readonly courseId: string,
    readonly date: string,
    readonly status: ClassStatus,
    readonly cancellationReason: string | null,
    readonly version: number,
  ) {}

  /** Crea una clase recién dictada (`version` 1) y emite `class-session.created`. */
  static create(input: ClassSessionCreateInput): ClassSession {
    const courseId = normalizeCourseId(input.courseId);
    const date = normalizeCalendarDate(input.date);
    const id = input.idGenerator.next();

    const session = new ClassSession(id, input.tenantId, courseId, date, 'dictada', null, 1);

    session.#events.push({
      id: input.idGenerator.next(),
      type: 'class-session.created',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { courseId, date, status: 'dictada' },
    });

    return session;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: ClassSessionSnapshot): ClassSession {
    assertStatus(snapshot.status);
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de una clase debe ser un entero >= 1.');
    }

    const reason =
      snapshot.cancellationReason === null
        ? null
        : normalizeCancellationReason(snapshot.cancellationReason);
    assertConsistent(snapshot.status, reason);

    return new ClassSession(
      snapshot.id,
      snapshot.tenantId,
      normalizeCourseId(snapshot.courseId),
      normalizeCalendarDate(snapshot.date),
      snapshot.status,
      reason,
      snapshot.version,
    );
  }

  /** Marca la clase como `cancelada` con motivo (obligatorio). */
  cancel(input: ClassSessionCancelInput): ClassSession {
    return this.#transition('cancelada', normalizeCancellationReason(input.reason), input);
  }

  /** Marca la clase como `feriado` (sin motivo). */
  markHoliday(input: ClassSessionTransitionInput): ClassSession {
    return this.#transition('feriado', null, input);
  }

  /** Marca la clase como `sin_clase` (sin motivo). */
  markNoClass(input: ClassSessionTransitionInput): ClassSession {
    return this.#transition('sin_clase', null, input);
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): ClassSessionSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      courseId: this.courseId,
      date: this.date,
      status: this.status,
      cancellationReason: this.cancellationReason,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }

  #transition(
    status: ClassStatus,
    reason: string | null,
    input: ClassSessionTransitionInput,
  ): ClassSession {
    assertConsistent(status, reason);

    if (status === this.status) {
      return this; // no-op: mismo estado, sin evento ni incremento de versión.
    }

    const next = new ClassSession(
      this.id,
      this.tenantId,
      this.courseId,
      this.date,
      status,
      reason,
      this.version + 1,
    );

    next.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'class-session.status-changed',
        aggregateId: this.id,
        occurredAt: input.clock.now(),
        payload: { from: this.status, to: status, reason },
      },
    ];

    return next;
  }
}
