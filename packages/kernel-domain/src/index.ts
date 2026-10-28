/**
 * `@kernel/domain` — dominio puro del kernel (TypeScript, CERO dependencias, D5).
 *
 * Solo mecánica compartida: el tipo base de evento de dominio y los puertos que
 * el dominio necesita (D6, §4.1). **No** incluye agregados, value objects ni
 * repositorios genéricos: eso es de cada vertical, o se admite al kernel solo
 * cuando la segunda vertical lo confirme (ODD #3, D18; ver ADR 0005).
 */
export type { DomainEvent } from './domain-event.js';
export type { Clock } from './ports/clock.js';
export type { IdGenerator } from './ports/id-generator.js';
export type { OutboxPort } from './ports/outbox.js';
export type { UnitOfWork } from './ports/unit-of-work.js';
