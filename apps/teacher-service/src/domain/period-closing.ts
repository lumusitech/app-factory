import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Cierre` — cierre de período (`docs/teacher-service-context.md` §3.1/§3.5;
 * ADR 0016, F-12 parcial).
 *
 * Es un **agregado batch por (curso, período)**: la hoja de **overrides manuales**
 * se captura y se guarda **atómica**
 * (`PUT /courses/:courseId/period-closings/:period`), porque el ritual de cierre es
 * un **acto** (§1.3). Se persiste como filas por (curso, período, alumno).
 *
 * Cada entrada es **solo la nota manual** que el docente decide (el *override*) con
 * su **motivo opcional**. La **nota automática** (promedio simple de las notas
 * vigentes del período, F-02) **no** se persiste: es una vista derivada (T6/§7.1,
 * ADR 0016). `value` es la escala **entera 1–10** (T16); `period` es un texto
 * **opaco** (referencia al período del calendario institucional, que no se modela
 * todavía): no se hardcodea `C1`/`C2` (§7.8). `studentId` es el **legajo interno**
 * (T4): un identificador estable, **nunca** la posición en la lista (§7.4).
 */

export const COURSE_ID_MAX_LENGTH = 200;
export const PERIOD_MAX_LENGTH = 200;
export const STUDENT_ID_MAX_LENGTH = 200;
export const CLOSING_MOTIVE_MAX_LENGTH = 4000;
export const CLOSING_GRADE_MIN = 1;
export const CLOSING_GRADE_MAX = 10;

export interface PeriodClosingEntry {
  readonly studentId: string;
  readonly value: number;
  readonly motive: string | null;
}

export interface PeriodClosingSnapshot {
  readonly courseId: string;
  readonly period: string;
  readonly tenantId: TenantId;
  readonly entries: readonly PeriodClosingEntry[];
  readonly version: number;
}

export interface PeriodClosingInput {
  readonly tenantId: TenantId;
  readonly courseId: unknown;
  readonly period: unknown;
  readonly entries: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
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

function normalizePeriod(value: unknown): string {
  const period = typeof value === 'string' ? value.trim() : '';
  if (period === '' || period.length > PERIOD_MAX_LENGTH) {
    throw new Error(
      `El \`period\` debe ser un texto no vacío de hasta ${PERIOD_MAX_LENGTH} caracteres.`,
    );
  }
  return period;
}

function normalizeValue(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < CLOSING_GRADE_MIN ||
    value > CLOSING_GRADE_MAX
  ) {
    throw new Error(
      `La nota de cierre debe ser un entero entre ${CLOSING_GRADE_MIN} y ${CLOSING_GRADE_MAX}.`,
    );
  }
  return value;
}

function normalizeMotive(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const motive = typeof value === 'string' ? value.trim() : '';
  if (motive === '') {
    return null;
  }
  if (motive.length > CLOSING_MOTIVE_MAX_LENGTH) {
    throw new Error(`El motivo no puede superar ${CLOSING_MOTIVE_MAX_LENGTH} caracteres.`);
  }
  return motive;
}

/** Normaliza las entradas: valida, rechaza `studentId` duplicado y ordena por alumno. */
function normalizeEntries(value: unknown): readonly PeriodClosingEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Las entradas del cierre deben ser una lista.');
  }

  const seen = new Set<string>();
  const entries: PeriodClosingEntry[] = value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Cada entrada del cierre debe ser un objeto { studentId, value, motive? }.');
    }
    const candidate = raw as Record<string, unknown>;
    const studentId = typeof candidate.studentId === 'string' ? candidate.studentId.trim() : '';
    if (studentId === '' || studentId.length > STUDENT_ID_MAX_LENGTH) {
      throw new Error(
        `El \`studentId\` (legajo) debe ser un texto no vacío de hasta ${STUDENT_ID_MAX_LENGTH} caracteres.`,
      );
    }
    if (seen.has(studentId)) {
      throw new Error(`El alumno "${studentId}" aparece más de una vez en el cierre.`);
    }
    seen.add(studentId);
    return {
      studentId,
      value: normalizeValue(candidate.value),
      motive: normalizeMotive(candidate.motive),
    };
  });

  return entries.sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
}

function sameEntries(a: readonly PeriodClosingEntry[], b: readonly PeriodClosingEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.studentId === b[index]?.studentId &&
        entry.value === b[index]?.value &&
        entry.motive === b[index]?.motive,
    )
  );
}

export class PeriodClosing {
  #events: DomainEvent[] = [];

  private constructor(
    readonly courseId: string,
    readonly period: string,
    readonly tenantId: TenantId,
    readonly entries: readonly PeriodClosingEntry[],
    readonly version: number,
  ) {}

  /** Fija la hoja de overrides (`version` 1) y emite `period-closing.recorded`. */
  static create(input: PeriodClosingInput): PeriodClosing {
    const courseId = normalizeCourseId(input.courseId);
    const period = normalizePeriod(input.period);
    const entries = normalizeEntries(input.entries);

    const closing = new PeriodClosing(courseId, period, input.tenantId, entries, 1);

    closing.#events.push({
      id: input.idGenerator.next(),
      type: 'period-closing.recorded',
      aggregateId: courseId,
      occurredAt: input.clock.now(),
      payload: { period, entries },
    });

    return closing;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: PeriodClosingSnapshot): PeriodClosing {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión del cierre debe ser un entero >= 1.');
    }
    return new PeriodClosing(
      normalizeCourseId(snapshot.courseId),
      normalizePeriod(snapshot.period),
      snapshot.tenantId,
      normalizeEntries(snapshot.entries),
      snapshot.version,
    );
  }

  /**
   * Reemplaza la hoja de overrides. Reemplazar por las **mismas** entradas es
   * **no-op** (sin evento ni incremento); un cambio sube la versión y emite
   * `period-closing.recorded`.
   */
  replace(input: PeriodClosingInput): PeriodClosing {
    const entries = normalizeEntries(input.entries);
    if (sameEntries(entries, this.entries)) {
      return this;
    }

    const next = new PeriodClosing(
      this.courseId,
      this.period,
      this.tenantId,
      entries,
      this.version + 1,
    );
    next.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'period-closing.recorded',
        aggregateId: this.courseId,
        occurredAt: input.clock.now(),
        payload: { period: this.period, entries },
      },
    ];
    return next;
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): PeriodClosingSnapshot {
    return {
      courseId: this.courseId,
      period: this.period,
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
