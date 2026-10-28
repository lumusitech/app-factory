/**
 * Evento de dominio del kernel.
 *
 * Se emite vía outbox (D9/D10): el evento se escribe en la misma transacción que
 * el agregado y se publica después. `@kernel/domain` **no** define agregados —eso
 * es de cada vertical—; solo el tipo base del evento. `payload` es genérico a
 * propósito: el kernel no conoce tipos de entidad (D5, §8).
 */
export interface DomainEvent<TPayload = unknown> {
  /** Identificador del evento, generado en el dominio (UUIDv7 vía `IdGenerator`). */
  readonly id: string;
  /** Tipo del evento, p. ej. `work-order.opened`. */
  readonly type: string;
  /** Identificador del agregado que emitió el evento. */
  readonly aggregateId: string;
  /** Instante de ocurrencia (vía `Clock`). */
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
