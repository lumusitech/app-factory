import type { QueuedRequest } from '@kernel/contracts';
import { HEADERS, OFFLINE_REPLAY_VALUE } from '@kernel/contracts';

/**
 * Headers del replay (sync §6): `Idempotency-Key` (la misma en cada intento para
 * que el servidor reconozca el duplicado) y `X-Offline-Replay` (señal de origen).
 * El `baseVersion` del item viaja como `X-Sync-Base-Version` (sync §8.1).
 */
export function buildReplayHeaders(item: QueuedRequest): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADERS.idempotencyKey]: item.idempotencyKey,
    [HEADERS.offlineReplay]: OFFLINE_REPLAY_VALUE,
  };

  if (item.baseVersion !== null && item.baseVersion !== undefined) {
    headers[HEADERS.syncBaseVersion] = item.baseVersion;
  }

  return headers;
}
