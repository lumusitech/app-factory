/**
 * Formas de la política de conflicto de sync (`docs/contracts/sync.md` §8;
 * ADR 0002). Viven en `kernel-contracts` por la misma razón que el registro de
 * idempotencia (ADR 0006 punto 5): son un *seam* compartido por el cliente
 * (`kernel-client`) y el borde (`kernel-http`), sin dependencias y sin invertir
 * ningún `persistence → http`. Se registra en el ADR 0008.
 *
 * El kernel **no mergea** (sync §8): detecta la escritura obsoleta y la resuelve
 * según una **política explícita de la vertical**, nunca en silencio.
 */

/** Política de conflicto de una vertical (sync §8.2). */
export type SyncPolicy = 'blocked' | 'lww';

/** Política por defecto del kernel si la vertical no declara ninguna (sync §8.2). */
export const DEFAULT_SYNC_POLICY: SyncPolicy = 'blocked';

/**
 * Señal de sobrescritura de `lww` (sync §8.2): mínimo versión previa, actor,
 * etiqueta legible de dispositivo/sesión y timestamp. `lww` **nunca** es
 * silenciosa: el servidor devuelve esta señal y la UI advierte.
 *
 * La etiqueta de dispositivo y el actor los deriva el **servidor**; no se confía
 * en lo que declare el cliente (sync §8.2).
 */
export interface OverwriteSignal {
  /** Token de versión **previo** (el que el cliente envió como `baseVersion`). Opaco. */
  readonly previousVersion: string;
  /** Actor que resolvió la sobrescritura (derivado por el servidor). */
  readonly actor: string;
  /** Etiqueta legible de dispositivo/sesión (derivada por el servidor). */
  readonly deviceLabel: string;
  /** Instante de la respuesta en ISO 8601. */
  readonly at: string;
}

/**
 * Lee la señal de sobrescritura de un body de respuesta (`Envelope.sync`),
 * devolviendo `null` si no está presente o no tiene la forma esperada. No lanza:
 * el cliente del borde es tolerante a un body inesperado.
 */
export function parseOverwriteSignal(value: unknown): OverwriteSignal | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const sync = (value as { sync?: unknown }).sync;
  if (typeof sync !== 'object' || sync === null) {
    return null;
  }
  const candidate = sync as Record<string, unknown>;
  if (
    typeof candidate.previousVersion === 'string' &&
    typeof candidate.actor === 'string' &&
    typeof candidate.deviceLabel === 'string' &&
    typeof candidate.at === 'string'
  ) {
    return {
      previousVersion: candidate.previousVersion,
      actor: candidate.actor,
      deviceLabel: candidate.deviceLabel,
      at: candidate.at,
    };
  }
  return null;
}
