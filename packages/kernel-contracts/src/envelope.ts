import type { OverwriteSignal } from './sync.js';

/**
 * Envelope de transporte del kernel (`docs/kernel-context.md` §1.1 y §5).
 *
 * Solo describe la **forma** del transporte. No exporta tipos de entidad (§8):
 * `data` es genérico y lo decide el endpoint.
 */
export interface Envelope<T> {
  readonly statusCode: number;
  readonly data: T;
  /** Instante de la respuesta en ISO 8601. */
  readonly timestamp: string;
  /**
   * Señal de sobrescritura de `lww` (sync §8.2). Presente **solo** cuando una
   * escritura bajo política `lww` pisó una versión más nueva; la UI advierte.
   * Ausente en el resto de las respuestas. Decisión registrada en el ADR 0008.
   */
  readonly sync?: OverwriteSignal;
}

/** Envelope de error del kernel (§1.1, §5). */
export interface ErrorEnvelope {
  readonly statusCode: number;
  readonly message: string;
  /** Código de error legible por máquina (`ErrorCode`) o `null`. */
  readonly error: string | null;
  /** Instante de la respuesta en ISO 8601. */
  readonly timestamp: string;
}
