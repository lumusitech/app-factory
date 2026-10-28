/**
 * Puerto de unidad de trabajo (§4.1, §8).
 *
 * `run` ejecuta un trabajo dentro de una transacción y le entrega el bag de
 * repositorios. Está parametrizado por ese bag (`TRepositories`) para **no**
 * imponer un repositorio genérico: D6 exige puertos por agregado, no
 * `Repository<T>` (prohibición de §6). La forma concreta del bag la decide el
 * composition root del producto.
 */
export interface UnitOfWork<TRepositories = unknown> {
  run<TResult>(work: (repositories: TRepositories) => Promise<TResult>): Promise<TResult>;
}
