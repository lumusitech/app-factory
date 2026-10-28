import { expectTypeOf } from 'vitest';

import type { Clock, DomainEvent, IdGenerator, OutboxPort, UnitOfWork } from './index.js';

// Contratos de tipo de los puertos (§4.1) y del evento de dominio (D9/D10).
// El paquete es solo mecánica: no incluye repositorios ni agregados concretos.
expectTypeOf<IdGenerator['next']>().toEqualTypeOf<() => string>();
expectTypeOf<Clock['now']>().toEqualTypeOf<() => Date>();
expectTypeOf<OutboxPort['append']>().toEqualTypeOf<
  (events: readonly DomainEvent[]) => Promise<void>
>();

type Repositories = { readonly orders: readonly string[] };
expectTypeOf<UnitOfWork<Repositories>['run']>().toEqualTypeOf<
  <TResult>(work: (repositories: Repositories) => Promise<TResult>) => Promise<TResult>
>();

// `DomainEvent` es genérico en su `payload`: el kernel no conoce tipos de entidad.
expectTypeOf<DomainEvent['id']>().toEqualTypeOf<string>();
expectTypeOf<DomainEvent['type']>().toEqualTypeOf<string>();
expectTypeOf<DomainEvent['aggregateId']>().toEqualTypeOf<string>();
expectTypeOf<DomainEvent['occurredAt']>().toEqualTypeOf<Date>();
expectTypeOf<DomainEvent<{ total: number }>['payload']>().toEqualTypeOf<{ total: number }>();
