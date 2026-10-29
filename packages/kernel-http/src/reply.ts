import type { OverwriteSignal } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';
import type { FastifyReply } from 'fastify';

import { okEnvelope } from './envelope.js';

/**
 * Responde con el envelope del kernel fijando **también** el status HTTP.
 *
 * Evita que el `statusCode` del envelope y el de la respuesta diverjan (un
 * `201 Created` que viaja como `200`): el contrato usa el status para el replay
 * (contrato de idempotencia §5), así que ambos deben ser el mismo número.
 *
 * `sync` (opcional) adjunta la señal de sobrescritura de `lww` (sync §8.2).
 */
export function sendEnvelope<T>(
  reply: FastifyReply,
  data: T,
  clock: Clock,
  statusCode = 200,
  sync?: OverwriteSignal,
): void {
  reply.code(statusCode).send(okEnvelope(data, clock, statusCode, sync));
}
