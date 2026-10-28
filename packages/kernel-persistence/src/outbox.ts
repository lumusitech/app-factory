import type { DomainEvent, OutboxPort } from '@kernel/domain';

import type { TransactionContext } from './unit-of-work.js';

/**
 * Adaptador del outbox (D9/D10).
 *
 * Escribe los eventos con el `executor` **de la transacción en curso** y con el
 * `tenantId` del `ScopeContext`: el evento queda en la misma transacción que el
 * agregado. Si la transacción revierte, el evento no existe; el outbox es además
 * el log de sincronización (D10).
 */
export class PgOutboxPort implements OutboxPort {
  constructor(private readonly context: TransactionContext) {}

  async append(events: readonly DomainEvent[]): Promise<void> {
    const { executor, tenantId } = this.context;

    for (const event of events) {
      await executor.query(
        `INSERT INTO outbox (id, tenant_id, type, aggregate_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          event.id,
          tenantId,
          event.type,
          event.aggregateId,
          event.occurredAt,
          JSON.stringify(event.payload ?? null),
        ],
      );
    }
  }
}

export type DomainEventListener = (event: DomainEvent) => void | Promise<void>;

export interface OutboxDeliveryFailure {
  readonly eventId: string;
  readonly error: unknown;
}

/**
 * Publica los eventos **después** del commit (§4, D9/D10).
 *
 * El evento ya está durable en el outbox (misma transacción que el agregado):
 * acá solo se despacha a listeners in-process. Un listener que falla **no**
 * pierde el evento (la fila persiste) ni impide que los demás lo reciban; el
 * fallo se devuelve para que el composition root lo registre.
 */
export class OutboxPublisher {
  readonly #listeners = new Set<DomainEventListener>();

  subscribe(listener: DomainEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async publish(events: readonly DomainEvent[]): Promise<readonly OutboxDeliveryFailure[]> {
    const failures: OutboxDeliveryFailure[] = [];

    for (const event of events) {
      for (const listener of this.#listeners) {
        try {
          await listener(event);
        } catch (error) {
          failures.push({ eventId: event.id, error });
        }
      }
    }

    return failures;
  }
}