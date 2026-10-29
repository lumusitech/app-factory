import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Evaluación` — evaluación de un curso (`docs/teacher-service-context.md` §3.1;
 * ADR 0012, F-02).
 *
 * `Curso → Evaluación (nombre, período, peso)` y `Evaluación → Nota (alumno,
 * valor)`. `courseId` es una referencia **opaca** hasta que se modele `Curso`
 * (ADR 0010/0011).
 *
 * `period` es un texto **opaco** (referencia al período del **calendario
 * institucional**, que no se modela todavía): no se hardcodea `C1`/`C2` (§7.8).
 * `weight` es un número positivo; su uso —el promedio ponderado— es una **vista
 * derivada** (T6), no parte de F-02.
 *
 * Es de **solo creación** en F-02 (como `Topic`). El `id` lo puede aportar el
 * **cliente** (UUIDv7, D8): permite crear la evaluación y cargar sus notas
 * (`GradeSheet`) en la misma sesión offline, sin esperar al flush. Sin `id`, lo
 * genera el servidor.
 */

export const COURSE_ID_MAX_LENGTH = 200;
export const EVALUATION_ID_MAX_LENGTH = 200;
export const EVALUATION_NAME_MAX_LENGTH = 200;
export const EVALUATION_PERIOD_MAX_LENGTH = 200;

export interface EvaluationSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly courseId: string;
  readonly name: string;
  readonly period: string;
  readonly weight: number;
  readonly version: number;
}

export interface EvaluationCreateInput {
  readonly tenantId: TenantId;
  readonly courseId: unknown;
  readonly name: unknown;
  readonly period: unknown;
  readonly weight: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  /** Id opcional aportado por el cliente (UUIDv7, D8); sin él, lo genera el servidor. */
  readonly id?: unknown;
}

function normalizeId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > EVALUATION_ID_MAX_LENGTH) {
    throw new Error(
      `El \`id\` de la evaluación debe ser un texto no vacío de hasta ${EVALUATION_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return id;
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

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '' || name.length > EVALUATION_NAME_MAX_LENGTH) {
    throw new Error(
      `El nombre de la evaluación debe ser un texto no vacío de hasta ${EVALUATION_NAME_MAX_LENGTH} caracteres.`,
    );
  }
  return name;
}

function normalizePeriod(value: unknown): string {
  const period = typeof value === 'string' ? value.trim() : '';
  if (period === '' || period.length > EVALUATION_PERIOD_MAX_LENGTH) {
    throw new Error(
      `El período de la evaluación debe ser un texto no vacío de hasta ${EVALUATION_PERIOD_MAX_LENGTH} caracteres.`,
    );
  }
  return period;
}

function normalizeWeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('El peso de la evaluación debe ser un número positivo.');
  }
  return value;
}

export class Evaluation {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: TenantId,
    readonly courseId: string,
    readonly name: string,
    readonly period: string,
    readonly weight: number,
    readonly version: number,
  ) {}

  /** Crea una evaluación (`version` 1) y emite `evaluation.created`. */
  static create(input: EvaluationCreateInput): Evaluation {
    const id = normalizeId(input.id ?? input.idGenerator.next());
    const courseId = normalizeCourseId(input.courseId);
    const name = normalizeName(input.name);
    const period = normalizePeriod(input.period);
    const weight = normalizeWeight(input.weight);

    const evaluation = new Evaluation(id, input.tenantId, courseId, name, period, weight, 1);

    evaluation.#events.push({
      id: input.idGenerator.next(),
      type: 'evaluation.created',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { courseId, name, period, weight },
    });

    return evaluation;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: EvaluationSnapshot): Evaluation {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de una evaluación debe ser un entero >= 1.');
    }
    return new Evaluation(
      normalizeId(snapshot.id),
      snapshot.tenantId,
      normalizeCourseId(snapshot.courseId),
      normalizeName(snapshot.name),
      normalizePeriod(snapshot.period),
      normalizeWeight(snapshot.weight),
      snapshot.version,
    );
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): EvaluationSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      courseId: this.courseId,
      name: this.name,
      period: this.period,
      weight: this.weight,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }
}
