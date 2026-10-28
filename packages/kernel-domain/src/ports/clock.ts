/**
 * Reloj inyectable (§4.1).
 *
 * Permite testear el dominio sin depender de `Date.now()` y fechar los eventos de
 * forma determinista. La implementación concreta es un adaptador.
 */
export interface Clock {
  now(): Date;
}
