import type { DomainEvent } from '../domain-event.js';

/**
 * Puerto del outbox (D9/D10).
 *
 * Los eventos de dominio se escriben en la **misma transacción** que el agregado
 * y se publican después; el outbox es, además, el log de sincronización (D10). La
 * implementación (publisher, tabla, replay) vive en `kernel-persistence`; este
 * puerto solo fija la operación que el dominio necesita.
 */
export interface OutboxPort {
  /** Registra los eventos del agregado; debe participar de la transacción del `UnitOfWork`. */
  append(events: readonly DomainEvent[]): Promise<void>;
}
