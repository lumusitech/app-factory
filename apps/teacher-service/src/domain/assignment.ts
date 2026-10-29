import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Tarea` — la consigna del día (`docs/teacher-service-context.md` §4, F-01;
 * ADR 0011). No está en §3.1: es una ampliación del modelo registrada en el ADR.
 *
 * Se ata a la **Clase** (la consigna *del día*) con un `topicId` **opcional** (la
 * tarea puede referir el tema del plan). Puede haber **varias** por clase: cada
 * `Assignment` es su propia entidad (`version` 1 al crearse).
 */

export const CLASS_SESSION_ID_MAX_LENGTH = 200;
export const TOPIC_ID_MAX_LENGTH = 200;
export const ASSIGNMENT_CONTENT_MAX_LENGTH = 2000;

export interface AssignmentSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly classSessionId: string;
  readonly topicId: string | null;
  readonly content: string;
  readonly version: number;
}

export interface AssignmentCreateInput {
  readonly tenantId: TenantId;
  readonly classSessionId: unknown;
  readonly content: unknown;
  readonly topicId?: unknown;
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

function normalizeContent(value: unknown): string {
  const content = typeof value === 'string' ? value.trim() : '';
  if (content === '' || content.length > ASSIGNMENT_CONTENT_MAX_LENGTH) {
    throw new Error(
      `El contenido de la tarea debe ser un texto no vacío de hasta ${ASSIGNMENT_CONTENT_MAX_LENGTH} caracteres.`,
    );
  }
  return content;
}

function normalizeOptionalTopicId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > TOPIC_ID_MAX_LENGTH) {
    throw new Error(
      `El \`topicId\` debe ser un texto no vacío de hasta ${TOPIC_ID_MAX_LENGTH} caracteres, o nulo.`,
    );
  }
  return id;
}

export class Assignment {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: TenantId,
    readonly classSessionId: string,
    readonly topicId: string | null,
    readonly content: string,
    readonly version: number,
  ) {}

  /** Crea una tarea (`version` 1) y emite `assignment.created`. */
  static create(input: AssignmentCreateInput): Assignment {
    const id = input.idGenerator.next();
    const classSessionId = normalizeClassSessionId(input.classSessionId);
    const topicId = normalizeOptionalTopicId(input.topicId);
    const content = normalizeContent(input.content);

    const assignment = new Assignment(id, input.tenantId, classSessionId, topicId, content, 1);

    assignment.#events.push({
      id: input.idGenerator.next(),
      type: 'assignment.created',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { classSessionId, topicId, content },
    });

    return assignment;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: AssignmentSnapshot): Assignment {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de una tarea debe ser un entero >= 1.');
    }
    const id = typeof snapshot.id === 'string' ? snapshot.id.trim() : '';
    if (id === '') {
      throw new Error('El `id` de la tarea no puede ser vacío.');
    }
    return new Assignment(
      id,
      snapshot.tenantId,
      normalizeClassSessionId(snapshot.classSessionId),
      normalizeOptionalTopicId(snapshot.topicId),
      normalizeContent(snapshot.content),
      snapshot.version,
    );
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): AssignmentSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      classSessionId: this.classSessionId,
      topicId: this.topicId,
      content: this.content,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }
}
