import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Nota` — notas de una evaluación (`docs/teacher-service-context.md` §3.1;
 * ADR 0012, F-02).
 *
 * Es un **agregado batch por evaluación**: la hoja de notas se captura y se guarda
 * **atómica** (`PUT /evaluations/:id/grades`), porque el ritual es un **acto**
 * (§1.3: *"cargar 30 notas"*). Se persiste como filas por (evaluación, alumno), la
 * forma de §3.1.
 *
 * `studentId` es el **legajo interno** del alumno (T4): un identificador estable,
 * **nunca** la posición en la lista (§7.4). `value` es la escala **entera 1–10**
 * (T16). La nota **no** lleva fecha (§3.1): la trazabilidad la da el `occurredAt`
 * del evento de outbox.
 */

export const EVALUATION_ID_MAX_LENGTH = 200;
export const STUDENT_ID_MAX_LENGTH = 200;
export const GRADE_MIN = 1;
export const GRADE_MAX = 10;

export interface GradeEntry {
  readonly studentId: string;
  readonly value: number;
}

export interface GradeSheetSnapshot {
  readonly evaluationId: string;
  readonly tenantId: TenantId;
  readonly entries: readonly GradeEntry[];
  readonly version: number;
}

export interface GradeSheetInput {
  readonly tenantId: TenantId;
  readonly evaluationId: unknown;
  readonly entries: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

function normalizeEvaluationId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > EVALUATION_ID_MAX_LENGTH) {
    throw new Error(
      `El \`evaluationId\` debe ser un texto no vacío de hasta ${EVALUATION_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return id;
}

function normalizeValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < GRADE_MIN || value > GRADE_MAX) {
    throw new Error(
      `El valor de la nota debe ser un entero entre ${GRADE_MIN} y ${GRADE_MAX}.`,
    );
  }
  return value;
}

/** Normaliza las entradas: valida, rechaza `studentId` duplicado y ordena por alumno. */
function normalizeEntries(value: unknown): readonly GradeEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Las entradas de notas deben ser una lista.');
  }

  const seen = new Set<string>();
  const entries: GradeEntry[] = value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Cada entrada de notas debe ser un objeto { studentId, value }.');
    }
    const candidate = raw as Record<string, unknown>;
    const studentId = typeof candidate.studentId === 'string' ? candidate.studentId.trim() : '';
    if (studentId === '' || studentId.length > STUDENT_ID_MAX_LENGTH) {
      throw new Error(
        `El \`studentId\` (legajo) debe ser un texto no vacío de hasta ${STUDENT_ID_MAX_LENGTH} caracteres.`,
      );
    }
    if (seen.has(studentId)) {
      throw new Error(`El alumno "${studentId}" aparece más de una vez en las notas.`);
    }
    seen.add(studentId);
    return { studentId, value: normalizeValue(candidate.value) };
  });

  return entries.sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
}

function sameEntries(a: readonly GradeEntry[], b: readonly GradeEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.studentId === b[index]?.studentId && entry.value === b[index]?.value)
  );
}

export class GradeSheet {
  #events: DomainEvent[] = [];

  private constructor(
    readonly evaluationId: string,
    readonly tenantId: TenantId,
    readonly entries: readonly GradeEntry[],
    readonly version: number,
  ) {}

  /** Fija las notas de una evaluación (`version` 1) y emite `grades.recorded`. */
  static create(input: GradeSheetInput): GradeSheet {
    const evaluationId = normalizeEvaluationId(input.evaluationId);
    const entries = normalizeEntries(input.entries);

    const sheet = new GradeSheet(evaluationId, input.tenantId, entries, 1);

    sheet.#events.push({
      id: input.idGenerator.next(),
      type: 'grades.recorded',
      aggregateId: evaluationId,
      occurredAt: input.clock.now(),
      payload: { entries },
    });

    return sheet;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: GradeSheetSnapshot): GradeSheet {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de las notas debe ser un entero >= 1.');
    }
    return new GradeSheet(
      normalizeEvaluationId(snapshot.evaluationId),
      snapshot.tenantId,
      normalizeEntries(snapshot.entries),
      snapshot.version,
    );
  }

  /**
   * Reemplaza la hoja de notas. Reemplazar por las **mismas** entradas es
   * **no-op** (sin evento ni incremento); un cambio sube la versión y emite
   * `grades.recorded`.
   */
  replace(input: GradeSheetInput): GradeSheet {
    const entries = normalizeEntries(input.entries);
    if (sameEntries(entries, this.entries)) {
      return this;
    }

    const next = new GradeSheet(this.evaluationId, this.tenantId, entries, this.version + 1);
    next.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'grades.recorded',
        aggregateId: this.evaluationId,
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

  snapshot(): GradeSheetSnapshot {
    return {
      evaluationId: this.evaluationId,
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
