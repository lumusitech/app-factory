import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Asistencia` — asistencia de una clase (`docs/teacher-service-context.md` §3.1;
 * ADR 0011).
 *
 * Es un **agregado por clase**: la hoja de asistencia se captura y se guarda
 * **atómica** (`PUT /class-sessions/:id/attendance`), porque el ritual de aula es
 * un **acto** por clase (§1.3). Se persiste como filas por (clase, alumno), la
 * forma de §3.1.
 *
 * `studentId` es el **legajo interno** del alumno (T4): un identificador estable,
 * **nunca** la posición en la lista (§7.4). Es una referencia opaca hasta que se
 * modele `Alumno` (F-06).
 */

export const CLASS_SESSION_ID_MAX_LENGTH = 200;
export const STUDENT_ID_MAX_LENGTH = 200;

export const ATTENDANCE_STATUSES = [
  'presente',
  'ausente',
  'tarde',
  'justificada',
  'retirado',
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceEntry {
  readonly studentId: string;
  readonly status: AttendanceStatus;
}

export interface ClassAttendanceSnapshot {
  readonly classSessionId: string;
  readonly tenantId: TenantId;
  readonly entries: readonly AttendanceEntry[];
  readonly version: number;
}

export interface ClassAttendanceInput {
  readonly tenantId: TenantId;
  readonly classSessionId: unknown;
  readonly entries: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

function normalizeClassSessionId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > CLASS_SESSION_ID_MAX_LENGTH) {
    throw new Error(
      `El \`classSessionId\` debe ser un texto no vacío de hasta ${CLASS_SESSION_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return id;
}

function normalizeStatus(value: unknown): AttendanceStatus {
  if (typeof value !== 'string' || !(ATTENDANCE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`Estado de asistencia inválido: "${String(value)}".`);
  }
  return value as AttendanceStatus;
}

/** Normaliza las entradas: valida, rechaza `studentId` duplicado y ordena por alumno. */
function normalizeEntries(value: unknown): readonly AttendanceEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Las entradas de asistencia deben ser una lista.');
  }

  const seen = new Set<string>();
  const entries: AttendanceEntry[] = value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Cada entrada de asistencia debe ser un objeto { studentId, status }.');
    }
    const candidate = raw as Record<string, unknown>;
    const studentId = typeof candidate.studentId === 'string' ? candidate.studentId.trim() : '';
    if (studentId === '' || studentId.length > STUDENT_ID_MAX_LENGTH) {
      throw new Error(
        `El \`studentId\` (legajo) debe ser un texto no vacío de hasta ${STUDENT_ID_MAX_LENGTH} caracteres.`,
      );
    }
    if (seen.has(studentId)) {
      throw new Error(`El alumno "${studentId}" aparece más de una vez en la asistencia.`);
    }
    seen.add(studentId);
    return { studentId, status: normalizeStatus(candidate.status) };
  });

  return entries.sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
}

function sameEntries(a: readonly AttendanceEntry[], b: readonly AttendanceEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.studentId === b[index]?.studentId && entry.status === b[index]?.status)
  );
}

export class ClassAttendance {
  #events: DomainEvent[] = [];

  private constructor(
    readonly classSessionId: string,
    readonly tenantId: TenantId,
    readonly entries: readonly AttendanceEntry[],
    readonly version: number,
  ) {}

  /** Fija la asistencia de una clase (`version` 1) y emite `attendance.recorded`. */
  static create(input: ClassAttendanceInput): ClassAttendance {
    const classSessionId = normalizeClassSessionId(input.classSessionId);
    const entries = normalizeEntries(input.entries);

    const attendance = new ClassAttendance(classSessionId, input.tenantId, entries, 1);

    attendance.#events.push({
      id: input.idGenerator.next(),
      type: 'attendance.recorded',
      aggregateId: classSessionId,
      occurredAt: input.clock.now(),
      payload: { entries },
    });

    return attendance;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: ClassAttendanceSnapshot): ClassAttendance {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de la asistencia debe ser un entero >= 1.');
    }
    return new ClassAttendance(
      normalizeClassSessionId(snapshot.classSessionId),
      snapshot.tenantId,
      normalizeEntries(snapshot.entries),
      snapshot.version,
    );
  }

  /**
   * Reemplaza la hoja de asistencia. Reemplazar por las **mismas** entradas es
   * **no-op** (sin evento ni incremento); un cambio sube la versión y emite
   * `attendance.recorded`.
   */
  replace(input: ClassAttendanceInput): ClassAttendance {
    const entries = normalizeEntries(input.entries);
    if (sameEntries(entries, this.entries)) {
      return this;
    }

    const next = new ClassAttendance(
      this.classSessionId,
      this.tenantId,
      entries,
      this.version + 1,
    );
    next.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'attendance.recorded',
        aggregateId: this.classSessionId,
        occurredAt: input.clock.now(),
        payload: { entries },
      },
    ];
    return next;
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): ClassAttendanceSnapshot {
    return {
      classSessionId: this.classSessionId,
      tenantId: this.tenantId,
      entries: this.entries,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }
}
