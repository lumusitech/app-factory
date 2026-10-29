import type { QueuedRequest, QueuedRequestBlockedReason } from '@kernel/contracts';

import type { TransportResult } from './ports/transport.js';

/**
 * Clasificación del resultado de un envío (sync §4). Es la **única** fuente de
 * las transiciones: tres desenlaces observables.
 *
 * - `applied` (`2xx`) → el item se borra (`remove`).
 * - `blocked` (`401`/`4xx`) → `blocked` visible, nunca se descarta.
 * - `retained` (`5xx`/red/watchdog) → se conserva en `pending` y corta el flush.
 */
export type SendOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'blocked'; readonly reason: QueuedRequestBlockedReason }
  | { readonly kind: 'retained' };

/** Clasifica un status HTTP observado (sync §4). */
export function classifyStatusCode(statusCode: number, body: unknown): SendOutcome {
  if (statusCode >= 200 && statusCode < 300) {
    return { kind: 'applied' };
  }
  if (statusCode >= 400 && statusCode < 500) {
    // Incluye 401 (sesión inválida) y el 409 de conflicto: ambos `blocked`.
    return { kind: 'blocked', reason: blockedReason(statusCode, body) };
  }
  // 5xx (y cualquier otro): transitorio → conservar y cortar.
  return { kind: 'retained' };
}

/** Clasifica el resultado del transporte; un fallo de red es `retained`. */
export function classifyResult(result: TransportResult): SendOutcome {
  if (result.kind === 'network-error') {
    return { kind: 'retained' };
  }
  return classifyStatusCode(result.statusCode, result.body);
}

/** Marca un intento: suma `attempts` y fija `lastAttemptAt` (sync §7). */
export function markAttempt(item: QueuedRequest, nowIso: string): QueuedRequest {
  return { ...item, attempts: item.attempts + 1, lastAttemptAt: nowIso };
}

/** Conserva el item en `pending` (5xx/red/watchdog). Limpia un bloqueo previo. */
export function markRetained(item: QueuedRequest, nowIso: string): QueuedRequest {
  return { ...markAttempt(item, nowIso), state: 'pending', blockedReason: null };
}

/** Marca el item `blocked` con su motivo visible (sync §4). */
export function markBlocked(
  item: QueuedRequest,
  nowIso: string,
  reason: QueuedRequestBlockedReason,
): QueuedRequest {
  return { ...markAttempt(item, nowIso), state: 'blocked', blockedReason: reason };
}

/** Reencola un item `blocked` por intervención humana (sync §3). */
export function markRequeued(item: QueuedRequest): QueuedRequest {
  return { ...item, state: 'pending', blockedReason: null };
}

/** Extrae el motivo de bloqueo del envelope de error, o sintetiza uno. */
export function blockedReason(statusCode: number, body: unknown): QueuedRequestBlockedReason {
  if (typeof body === 'object' && body !== null) {
    const candidate = body as { message?: unknown; error?: unknown };
    return {
      statusCode,
      message: typeof candidate.message === 'string' ? candidate.message : 'Mutación rechazada.',
      error: typeof candidate.error === 'string' ? candidate.error : null,
    };
  }
  return { statusCode, message: 'Mutación rechazada.', error: null };
}
