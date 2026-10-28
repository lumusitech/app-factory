import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ScopeContext } from '@kernel/scope';
import { runWithScope } from '@kernel/scope';

/**
 * Resuelve la identidad de la request y la convierte en alcance (scope.md §4).
 *
 * La **autenticación** y el formato del token público son contratos aparte: el
 * kernel solo exige que su resultado se materialice en un `ScopeContext`. La
 * vertical provee este resolver en su composition root.
 *
 * Devuelve `null` cuando la request no toca datos de tenant (p. ej. `/probe`): en
 * ese caso **no se puebla** alcance (scope.md §1).
 */
export type ScopeResolver =
  | ((request: FastifyRequest) => Promise<ScopeContext | null> | ScopeContext | null)
  | null;

/**
 * Puebla el alcance **una vez por request**, antes del handler, y lo propaga por
 * todo el pipeline vía AsyncLocalStorage.
 *
 * Usa el patrón oficial de Fastify: se pasa el callback `done` a
 * `storage.run(scope, done)` (ver `test/als.test.js` de Fastify), de modo que
 * hooks posteriores, el handler y el filtro de errores ven el mismo alcance.
 */
export function registerScope(app: FastifyInstance, resolveScope: ScopeResolver): void {
  if (resolveScope === null) {
    return;
  }

  const resolver = resolveScope;

  app.addHook('onRequest', (request, _reply, done) => {
    void Promise.resolve()
      .then(() => resolver(request))
      .then((scope) => {
        if (scope === null) {
          done();
          return;
        }
        runWithScope(scope, done);
      })
      .catch((error: unknown) => {
        done(error as Error);
      });
  });
}