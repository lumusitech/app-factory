import type { UnitOfWork } from '@kernel/domain';
import { requireScope } from '@kernel/scope';

import type { SqlConnection, SqlExecutor } from './executor.js';

/** GUC de sesión con el tenant de la transacción; lo consume la política RLS (D12). */
export const TENANT_SETTING = 'app.tenant_id';

/**
 * Fija el tenant de la transacción con `is_local = true`: no sobrevive al commit
 * ni se filtra a la siguiente transacción del mismo pool.
 */
export async function setTenantSetting(executor: SqlExecutor, tenantId: string): Promise<void> {
  await executor.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);
}

/** Lo que ve un repositorio dentro de la transacción: executor + tenant del alcance. */
export interface TransactionContext {
  readonly executor: SqlExecutor;
  readonly tenantId: string;
}

export type RepositoryFactory<TRepositories> = (context: TransactionContext) => TRepositories;

/**
 * `UnitOfWork` sobre SQL (§4.1, D9/D10).
 *
 * `run` toma el alcance del ALS con `requireScope()` **antes** de abrir la
 * transacción: sin `ScopeContext` la operación **lanza** y no toca la base
 * (fail-closed, scope.md §6.2). Con alcance, fija `app.tenant_id` en la
 * transacción, de modo que el predicado de la aplicación y el backstop RLS (D12)
 * coinciden.
 */
export class PgUnitOfWork<TRepositories> implements UnitOfWork<TRepositories> {
  constructor(
    private readonly connection: SqlConnection,
    private readonly buildRepositories: RepositoryFactory<TRepositories>,
  ) {}

  async run<TResult>(work: (repositories: TRepositories) => Promise<TResult>): Promise<TResult> {
    const tenantId = requireScope().tenantId;

    return this.connection.transaction(async (executor) => {
      await setTenantSetting(executor, tenantId);
      const repositories = this.buildRepositories({ executor, tenantId });
      return work(repositories);
    });
  }
}