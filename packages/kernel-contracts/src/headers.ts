/**
 * Headers de idempotencia y replay del kernel.
 *
 * Viven en `kernel-contracts` según `docs/kernel-context.md` §4 y se definen en
 * `docs/contracts/idempotency.md` §9. Cualquier cliente (web, Android) los usa.
 */
export const HEADERS = {
  /** Clave de idempotencia de la operación lógica. Requerido en mutaciones protegidas. */
  idempotencyKey: 'Idempotency-Key',
  /** Marca que la request es un replay de la cola offline, no una acción nueva. */
  offlineReplay: 'X-Offline-Replay',
  /** Bypass explícito de la idempotencia, reservado a endpoints de probe. */
  connectivityProbe: 'X-Connectivity-Probe',
  /**
   * Token de versión de la entidad al capturar la mutación (sync §8.1). Viaja en
   * la request para que el servidor detecte una escritura obsoleta. El kernel lo
   * trata como **opaco**: su formato es decisión de la vertical. Se registra en
   * el ADR 0008.
   */
  syncBaseVersion: 'X-Sync-Base-Version',
} as const;

export type HeaderName = (typeof HEADERS)[keyof typeof HEADERS];

/** Valor canónico de `X-Connectivity-Probe` que activa el bypass. */
export const CONNECTIVITY_PROBE_VALUE = 'true';

/** Valor canónico de `X-Offline-Replay` que marca el origen (replay de la cola). */
export const OFFLINE_REPLAY_VALUE = 'true';

/**
 * Indica si el valor del header `X-Connectivity-Probe` activa el bypass
 * (`docs/contracts/idempotency.md` §9). El header HTTP es case-insensitive en el
 * nombre; el valor se compara recortado y sin distinguir mayúsculas.
 */
export function isConnectivityProbe(value: string | undefined): value is string {
  return value?.trim().toLowerCase() === CONNECTIVITY_PROBE_VALUE;
}
