import type { Clock, DomainEvent, IdGenerator, OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

/**
 * Agregado de **referencia** de la suite de convergencia (solo test).
 *
 * **No** es un agregado del kernel (§1.4; ADR 0005/0006): el kernel no tiene
 * agregados propios. Existe para ejercitar el protocolo de sync extremo a extremo
 * sin inyectar un agregado de vertical. Expone `version` como **token de versión
 * opaco** (sync §8.1): la suite lo usa como `baseVersion`.
 */

export const NOTE_TITLE_MAX = 120;

export interface NoteSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly version: number;
}

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title === '') {
    throw new Error('El título no puede estar vacío.');
  }
  if (title.length > NOTE_TITLE_MAX) {
    throw new Error(`El título no puede superar ${NOTE_TITLE_MAX} caracteres.`);
  }
  return title;
}

export class Note {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly title: string,
    readonly version: number,
  ) {}

  static create(input: {
    readonly tenantId: string;
    readonly title: string;
    readonly clock: Clock;
    readonly idGenerator: IdGenerator;
  }): Note {
    const title = normalizeTitle(input.title);
    const id = input.idGenerator.next();
    const note = new Note(id, input.tenantId, title, 1);
    note.#events.push({
      id: input.idGenerator.next(),
      type: 'conformance-note.created',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { title },
    });
    return note;
  }

  static hydrate(snapshot: NoteSnapshot): Note {
    return new Note(snapshot.id, snapshot.tenantId, normalizeTitle(snapshot.title), snapshot.version);
  }

  rename(input: { readonly title: string; readonly clock: Clock; readonly idGenerator: IdGenerator }): Note {
    const title = normalizeTitle(input.title);
    if (title === this.title) {
      return this;
    }
    const renamed = new Note(this.id, this.tenantId, title, this.version + 1);
    renamed.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'conformance-note.renamed',
        aggregateId: this.id,
        occurredAt: input.clock.now(),
        payload: { title, from: this.title },
      },
    ];
    return renamed;
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): NoteSnapshot {
    return { id: this.id, tenantId: this.tenantId, title: this.title, version: this.version };
  }
}

/** Token de versión **opaco** (sync §8.1): el kernel solo compara strings. */
export function versionToken(note: Note): string {
  return String(note.version);
}

export interface NoteRepository {
  byId(id: string): Promise<Note | null>;
  save(note: Note): Promise<void>;
}

type NoteRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly title: string;
  readonly version: number;
};

export class PgNoteRepository implements NoteRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<Note | null> {
    const { rows } = await this.context.executor.query<NoteRow>(
      'SELECT id, tenant_id, title, version FROM conformance_note WHERE tenant_id = $1 AND id = $2',
      [this.context.tenantId, id],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return Note.hydrate({
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      version: row.version,
    });
  }

  async save(note: Note): Promise<void> {
    const snapshot = note.snapshot();
    await this.context.executor.query(
      `INSERT INTO conformance_note (id, tenant_id, title, version) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, version = EXCLUDED.version`,
      [snapshot.id, snapshot.tenantId, snapshot.title, snapshot.version],
    );
    await this.outbox.append(note.pullEvents());
  }
}
