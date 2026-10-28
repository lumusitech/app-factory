import type { Clock, DomainEvent, IdGenerator, OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

/**
 * Agregado de **referencia** (solo test).
 *
 * **No** es un agregado del kernel: el kernel no tiene agregados propios (§1.4;
 * ADR 0005/0006). Existe para probar el criterio de salida de la fase 2 —*"un
 * agregado con invariantes persiste, emite outbox y respeta alcance"*— sin
 * inyectar un agregado de vertical en el kernel.
 */

export const SAMPLE_NOTE_TITLE_MAX = 120;

export interface SampleNoteSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly version: number;
}

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title === '') {
    throw new Error('El título de la nota no puede estar vacío.');
  }
  if (title.length > SAMPLE_NOTE_TITLE_MAX) {
    throw new Error(`El título no puede superar ${SAMPLE_NOTE_TITLE_MAX} caracteres.`);
  }
  return title;
}

export class SampleNote {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly title: string,
    readonly version: number,
  ) {}

  /** Construye el agregado completo en memoria, con ID del dominio (D8). */
  static create(input: {
    readonly tenantId: string;
    readonly title: string;
    readonly clock: Clock;
    readonly idGenerator: IdGenerator;
  }): SampleNote {
    const title = normalizeTitle(input.title);
    const id = input.idGenerator.next();
    const note = new SampleNote(id, input.tenantId, title, 1);
    note.#events.push({
      id: input.idGenerator.next(),
      type: 'sample-note.created',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { title },
    });
    return note;
  }

  static hydrate(snapshot: SampleNoteSnapshot): SampleNote {
    if (snapshot.version < 1) {
      throw new Error('La versión de la nota debe ser >= 1.');
    }
    return new SampleNote(snapshot.id, snapshot.tenantId, normalizeTitle(snapshot.title), snapshot.version);
  }

  /** Cambia el título subiendo la versión; un título idéntico no emite evento. */
  rename(input: {
    readonly title: string;
    readonly clock: Clock;
    readonly idGenerator: IdGenerator;
  }): SampleNote {
    const title = normalizeTitle(input.title);
    if (title === this.title) {
      return this;
    }
    const renamed = new SampleNote(this.id, this.tenantId, title, this.version + 1);
    renamed.#events = [
      ...this.#events,
      {
        id: input.idGenerator.next(),
        type: 'sample-note.renamed',
        aggregateId: this.id,
        occurredAt: input.clock.now(),
        payload: { title, from: this.title },
      },
    ];
    return renamed;
  }

  /** Extrae los eventos pendientes (se escriben al persistir, en la misma tx). */
  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): SampleNoteSnapshot {
    return { id: this.id, tenantId: this.tenantId, title: this.title, version: this.version };
  }
}

/** Puerto **por agregado** (D6): nunca un `Repository<T>` genérico. */
export interface SampleNoteRepository {
  byId(id: string): Promise<SampleNote | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(note: SampleNote): Promise<void>;
}

type NoteRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly title: string;
  readonly version: number;
};

export class PgSampleNoteRepository implements SampleNoteRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<SampleNote | null> {
    // Predicado de alcance en la aplicación (scope.md §5): nunca sin tenant.
    const { rows } = await this.context.executor.query<NoteRow>(
      'SELECT id, tenant_id, title, version FROM sample_note WHERE tenant_id = $1 AND id = $2',
      [this.context.tenantId, id],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return SampleNote.hydrate({
      id: row.id,
      tenantId: row.tenant_id,
      title: row.title,
      version: row.version,
    });
  }

  async save(note: SampleNote): Promise<void> {
    const snapshot = note.snapshot();
    await this.context.executor.query(
      `INSERT INTO sample_note (id, tenant_id, title, version) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, version = EXCLUDED.version`,
      [snapshot.id, snapshot.tenantId, snapshot.title, snapshot.version],
    );
    await this.outbox.append(note.pullEvents());
  }
}