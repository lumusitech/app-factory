import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Tema` — tema del plan de un curso (`docs/teacher-service-context.md` §3.1;
 * ADR 0011).
 *
 * Un `Topic` pertenece al **plan** del curso: `(courseId, order, content)`. **No**
 * lleva fechas: el cronograma se **deriva** de los temas ordenados × clases
 * válidas (§7.2/§7.3). `courseId` es una referencia **opaca** hasta que se modele
 * `Curso` (ADR 0010).
 *
 * El `id` lo puede aportar el **cliente** (UUIDv7, D8): es lo que permite crear un
 * tema y vincularlo (`ClassTopic`) en la misma sesión offline, sin esperar al
 * flush. Sin `id`, lo genera el servidor.
 */

export const COURSE_ID_MAX_LENGTH = 200;
export const TOPIC_ID_MAX_LENGTH = 200;
export const TOPIC_CONTENT_MAX_LENGTH = 2000;
export const TOPIC_ORDER_MIN = 1;
export const TOPIC_ORDER_MAX = 10000;

export interface TopicSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly courseId: string;
  readonly order: number;
  readonly content: string;
  readonly version: number;
}

export interface TopicCreateInput {
  readonly tenantId: TenantId;
  readonly courseId: unknown;
  readonly order: unknown;
  readonly content: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  /** Id opcional aportado por el cliente (UUIDv7, D8); sin él, lo genera el servidor. */
  readonly id?: unknown;
}

function normalizeId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > TOPIC_ID_MAX_LENGTH) {
    throw new Error(
      `El \`id\` del tema debe ser un texto no vacío de hasta ${TOPIC_ID_MAX_LENGTH} caracteres.`,
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

function normalizeOrder(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < TOPIC_ORDER_MIN ||
    value > TOPIC_ORDER_MAX
  ) {
    throw new Error(
      `El \`order\` del tema debe ser un entero entre ${TOPIC_ORDER_MIN} y ${TOPIC_ORDER_MAX}.`,
    );
  }
  return value;
}

function normalizeContent(value: unknown): string {
  const content = typeof value === 'string' ? value.trim() : '';
  if (content === '' || content.length > TOPIC_CONTENT_MAX_LENGTH) {
    throw new Error(
      `El contenido del tema debe ser un texto no vacío de hasta ${TOPIC_CONTENT_MAX_LENGTH} caracteres.`,
    );
  }
  return content;
}

export class Topic {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: TenantId,
    readonly courseId: string,
    readonly order: number,
    readonly content: string,
    readonly version: number,
  ) {}

  /** Crea un tema del plan (`version` 1) y emite `topic.created`. */
  static create(input: TopicCreateInput): Topic {
    const id = normalizeId(input.id ?? input.idGenerator.next());
    const courseId = normalizeCourseId(input.courseId);
    const order = normalizeOrder(input.order);
    const content = normalizeContent(input.content);

    const topic = new Topic(id, input.tenantId, courseId, order, content, 1);

    topic.#events.push({
      id: input.idGenerator.next(),
      type: 'topic.created',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { courseId, order, content },
    });

    return topic;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: TopicSnapshot): Topic {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de un tema debe ser un entero >= 1.');
    }
    return new Topic(
      normalizeId(snapshot.id),
      snapshot.tenantId,
      normalizeCourseId(snapshot.courseId),
      normalizeOrder(snapshot.order),
      normalizeContent(snapshot.content),
      snapshot.version,
    );
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): TopicSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      courseId: this.courseId,
      order: this.order,
      content: this.content,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }
}
