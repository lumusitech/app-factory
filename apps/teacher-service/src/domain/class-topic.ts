import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

/**
 * `Tema dictado` — vínculo Clase↔Tema (`docs/teacher-service-context.md` §3.1;
 * ADR 0011). Registra **qué `Topic` del plan se dictó** en una `Clase`: el "tema
 * del día".
 *
 * Es una entidad **aparte** del agregado `ClassSession` (ADR 0011): no toca su
 * máquina de estados ni su token. **No** guarda fechas ni mueve el tema al
 * cancelar (§7.2/§7.3, T11): es el registro de lo **dictado**, no el cronograma.
 *
 * La identidad es la **clase** (una relación por clase); `topicId` es una
 * referencia opaca al tema del plan.
 */

export const CLASS_SESSION_ID_MAX_LENGTH = 200;
export const TOPIC_ID_MAX_LENGTH = 200;

export interface ClassTopicSnapshot {
  readonly classSessionId: string;
  readonly tenantId: TenantId;
  readonly topicId: string;
  readonly version: number;
}

export interface ClassTopicInput {
  readonly tenantId: TenantId;
  readonly classSessionId: unknown;
  readonly topicId: unknown;
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

function normalizeTopicId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > TOPIC_ID_MAX_LENGTH) {
    throw new Error(
      `El \`topicId\` debe ser un texto no vacío de hasta ${TOPIC_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return id;
}

export class ClassTopic {
  #events: DomainEvent[] = [];

  private constructor(
    readonly classSessionId: string,
    readonly tenantId: TenantId,
    readonly topicId: string,
    readonly version: number,
  ) {}

  /** Fija el tema dictado de una clase (`version` 1) y emite `class-topic.set`. */
  static create(input: ClassTopicInput): ClassTopic {
    const classSessionId = normalizeClassSessionId(input.classSessionId);
    const topicId = normalizeTopicId(input.topicId);

    const classTopic = new ClassTopic(classSessionId, input.tenantId, topicId, 1);

    classTopic.#events.push({
      id: input.idGenerator.next(),
      type: 'class-topic.set',
      aggregateId: classSessionId,
      occurredAt: input.clock.now(),
      payload: { topicId },
    });

    return classTopic;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: ClassTopicSnapshot): ClassTopic {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión del tema dictado debe ser un entero >= 1.');
    }
    return new ClassTopic(
      normalizeClassSessionId(snapshot.classSessionId),
      snapshot.tenantId,
      normalizeTopicId(snapshot.topicId),
      snapshot.version,
    );
  }

  /**
   * Cambia el tema dictado. Re-fijar el **mismo** tema es **no-op** (sin evento ni
   * incremento de versión); otro tema sube la versión y emite `class-topic.set`.
   */
  setTopic(input: ClassTopicInput): ClassTopic {
    const topicId = normalizeTopicId(input.topicId);
    if (topicId === this.topicId) {
      return this;
    }

    const next = new ClassTopic(this.classSessionId, this.tenantId, topicId, this.version + 1);
    next.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'class-topic.set',
        aggregateId: this.classSessionId,
        occurredAt: input.clock.now(),
        payload: { topicId },
      },
    ];
    return next;
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): ClassTopicSnapshot {
    return {
      classSessionId: this.classSessionId,
      tenantId: this.tenantId,
      topicId: this.topicId,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }
}
