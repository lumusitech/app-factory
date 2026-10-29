import type { OfflinePolicy } from '@kernel/client';
import type { QueuedRequestMethod } from '@kernel/contracts';

/**
 * Política offline de `teacher-service` (F-01): qué mutaciones de captura de
 * clase son encolables (`docs/contracts/sync.md` §1). El núcleo del cliente no
 * conoce estas rutas (§1.2): las inyecta la vertical.
 *
 * Encolables: `POST /class-sessions` (crear) y `PATCH /class-sessions/:id`
 * (transición). El resto —lecturas y el probe— nunca se encola.
 */

const CLASS_SESSION_PATH = '/class-sessions';
const CLASS_SESSION_BY_ID = /^\/class-sessions\/[^/]+$/;

export const classSessionOfflinePolicy: OfflinePolicy = {
  isQueueable(method: QueuedRequestMethod, path: string): boolean {
    if (method === 'POST') {
      return path === CLASS_SESSION_PATH;
    }
    if (method === 'PATCH') {
      return CLASS_SESSION_BY_ID.test(path);
    }
    return false;
  },
};
