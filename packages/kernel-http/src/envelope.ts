import type { Envelope } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';

/**
 * Envelope exitoso del kernel (`docs/kernel-context.md` §1.1, §4).
 *
 * `timestamp` sale del `Clock` inyectado: los tests son deterministas y el
 * envelope no depende de `Date.now()`.
 */
export function okEnvelope<T>(data: T, clock: Clock, statusCode = 200): Envelope<T> {
  return {
    statusCode,
    data,
    timestamp: clock.now().toISOString(),
  };
}