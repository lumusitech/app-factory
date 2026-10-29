import type { Envelope, OverwriteSignal } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';

/**
 * Envelope exitoso del kernel (`docs/kernel-context.md` §1.1, §4).
 *
 * `timestamp` sale del `Clock` inyectado: los tests son deterministas y el
 * envelope no depende de `Date.now()`. `sync` (opcional) transporta la señal de
 * sobrescritura de `lww` (sync §8.2; ADR 0008).
 */
export function okEnvelope<T>(
  data: T,
  clock: Clock,
  statusCode = 200,
  sync?: OverwriteSignal,
): Envelope<T> {
  return {
    statusCode,
    data,
    timestamp: clock.now().toISOString(),
    ...(sync === undefined ? {} : { sync }),
  };
}
