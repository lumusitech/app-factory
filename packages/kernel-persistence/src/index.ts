/**
 * `@kernel/persistence` — adaptador de salida del kernel (D7, §4).
 *
 * Driver SQL (con `pg` en producción y PGlite en tests), unidad de trabajo con
 * outbox en la misma transacción (D9/D10), runner de migraciones forward-only con
 * checksum (D13), store de idempotencia y adaptadores `IdGenerator` (UUIDv7, D8)
 * y `Clock`. El esquema del kernel (con RLS, D12) vive en `migrations/`.
 */
export {
  createPgConnection,
  createPgExecutor,
  createPgliteConnection,
  createPgliteExecutor,
} from './executor.js';
export type {
  PgClientLike,
  PgPoolLike,
  PgQueryable,
  PgliteLike,
  PgliteQueryable,
  QueryResult,
  SqlConnection,
  SqlExecutor,
} from './executor.js';
export { PgIdempotencyStore } from './idempotency-store.js';
export {
  InvalidMigrationNameError,
  MigrationChecksumMismatchError,
  MigrationDivergenceError,
  loadMigrations,
  runMigrations,
} from './migrations.js';
export type { AppliedMigration, Migration, RunMigrationsOptions } from './migrations.js';
export { OutboxPublisher, PgOutboxPort } from './outbox.js';
export type { DomainEventListener, OutboxDeliveryFailure } from './outbox.js';
export { SystemClock, UuidV7Generator, uuidV7 } from './adapters.js';
export { PgUnitOfWork, setTenantSetting, TENANT_SETTING } from './unit-of-work.js';
export type { RepositoryFactory, TransactionContext } from './unit-of-work.js';