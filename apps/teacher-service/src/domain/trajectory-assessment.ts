import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Valoración` — valoración preliminar cualitativa (`docs/teacher-service-context.md`
 * §3.1/§3.4/§13.1; ADR 0013, F-03).
 *
 * Es un **agregado batch por (curso, período)**: la hoja de valoraciones se captura
 * y se guarda **atómica** (`PUT /courses/:courseId/trajectory-assessments/:period`),
 * porque el ritual de aula es un **acto** (§1.3: *"marcar la valoración de un curso"*).
 * Se persiste como filas por (curso, período, alumno).
 *
 * El valor es el enum de §3.4/§13.1: **TEA** (Trayectoria Educativa Avanzada),
 * **TEP** (en Proceso) y **TED** (Discontinua). `studentId` es el **legajo interno**
 * del alumno (T4): un identificador estable, **nunca** la posición en la lista
 * (§7.4). `period` es un texto **opaco** (referencia al período del calendario
 * institucional, que no se modela todavía): no se hardcodea `C1`/`C2` (§7.8).
 * La valoración **no** lleva fecha: la trazabilidad la da el `occurredAt` del
 * evento de outbox.
 */

export const COURSE_ID_MAX_LENGTH = 200;
export const PERIOD_MAX_LENGTH = 200;
export const STUDENT_ID_MAX_LENGTH = 200;

/** Valores válidos de la valoración preliminar (§3.4, §13.1). */
export const TRAJECTORY_RATINGS = ['TEA', 'TEP', 'TED'] as const;

export type TrajectoryRating = (typeof TRAJECTORY_RATINGS)[number];

export interface TrajectoryAssessmentEntry {
  readonly studentId: string;
  readonly rating: TrajectoryRating;
}

export interface TrajectoryAssessmentSnapshot {
  readonly courseId: string;
  readonly period: string;
  readonly tenantId: TenantId;
  readonly entries: readonly TrajectoryAssessmentEntry[];
  readonly version: number;
}

export interface TrajectoryAssessmentInput {
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

function normalizeRating(value: unknown): TrajectoryRating {
  if (typeof value !== 'string' || !(TRAJECTORY_RATINGS as readonly string[]).includes(value)) {
    throw new Error(`Valoración inválida: "${String(value)}". Se espera TEA, TEP o TED.`);
  }
  return value as TrajectoryRating;
}

/** Normaliza las entradas: valida, rechaza `studentId` duplicado y ordena por alumno. */
function normalizeEntries(value: unknown): readonly TrajectoryAssessmentEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Las entradas de valoración deben ser una lista.');
  }

  const seen = new Set<string>();
  const entries: TrajectoryAssessmentEntry[] = value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Cada entrada de valoración debe ser un objeto { studentId, rating }.');
    }
    const candidate = raw as Record<string, unknown>;
    const studentId = typeof candidate.studentId === 'string' ? candidate.studentId.trim() : '';
    if (studentId === '' || studentId.length > STUDENT_ID_MAX_LENGTH) {
      throw new Error(
        `El \`studentId\` (legajo) debe ser un texto no vacío de hasta ${STUDENT_ID_MAX_LENGTH} caracteres.`,
      );
    }
    if (seen.has(studentId)) {
      throw new Error(`El alumno "${studentId}" aparece más de una vez en la valoración.`);
    }
    seen.add(studentId);
    return { studentId, rating: normalizeRating(candidate.rating) };
  });

  return entries.sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
}

function sameEntries(
  a: readonly TrajectoryAssessmentEntry[],
  b: readonly TrajectoryAssessmentEntry[],
): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.studentId === b[index]?.studentId && entry.rating === b[index]?.rating)
  );
}

export class TrajectoryAssessment {
  #events: DomainEvent[] = [];

  private constructor(
    readonly courseId: string,
    readonly period: string,
    readonly tenantId: TenantId,
    readonly entries: readonly TrajectoryAssessmentEntry[],
    readonly version: number,
  ) {}

  /** Fija la hoja de valoraciones (`version` 1) y emite `trajectory-assessment.recorded`. */
  static create(input: TrajectoryAssessmentInput): TrajectoryAssessment {
    const courseId = normalizeCourseId(input.courseId);
    const period = normalizePeriod(input.period);
    const entries = normalizeEntries(input.entries);

    const assessment = new TrajectoryAssessment(courseId, period, input.tenantId, entries, 1);

    assessment.#events.push({
      id: input.idGenerator.next(),
      type: 'trajectory-assessment.recorded',
      aggregateId: courseId,
      occurredAt: input.clock.now(),
      payload: { period, entries },
    });

    return assessment;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: TrajectoryAssessmentSnapshot): TrajectoryAssessment {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de la valoración debe ser un entero >= 1.');
    }
    return new TrajectoryAssessment(
      normalizeCourseId(snapshot.courseId),
      normalizePeriod(snapshot.period),
      snapshot.tenantId,
      normalizeEntries(snapshot.entries),
      snapshot.version,
    );
  }

  /**
   * Reemplaza la hoja de valoraciones. Reemplazar por las **mismas** entradas es
   * **no-op** (sin evento ni incremento); un cambio sube la versión y emite
   * `trajectory-assessment.recorded`.
   */
  replace(input: TrajectoryAssessmentInput): TrajectoryAssessment {
    const entries = normalizeEntries(input.entries);
    if (sameEntries(entries, this.entries)) {
      return this;
    }

    const next = new TrajectoryAssessment(
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
        type: 'trajectory-assessment.recorded',
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

  snapshot(): TrajectoryAssessmentSnapshot {
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
