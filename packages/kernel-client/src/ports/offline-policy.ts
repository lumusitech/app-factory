import type { QueuedRequestMethod } from '@kernel/contracts';

/**
 * Política del motor offline, **sin dominio adentro** (§1.2: el anti-patrón
 * hardcodeaba las rutas no encolables y un refresh key del dominio). La vertical
 * inyecta sus reglas; el núcleo no las conoce.
 */
export interface OfflinePolicy {
  /**
   * `false` para una mutación que **nunca** debe encolarse (p. ej. un endpoint que
   * no admite replay). Por defecto, toda mutación es encolable.
   */
  readonly isQueueable?: (method: QueuedRequestMethod, path: string) => boolean;
}
