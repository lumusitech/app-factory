import { HEADERS } from '@kernel/contracts';
import type { FastifyRequest } from 'fastify';

/**
 * Lectura de los metadatos de sync en el borde (sync §8; ADR 0008/0011).
 *
 * `baseVersion` viaja en el header `X-Sync-Base-Version` (token opaco). La
 * etiqueta de dispositivo la **deriva el servidor** desde `user-agent` (§8.2); no
 * se confía en lo que declare el cliente.
 */

/** Lee el token de versión del header (`X-Sync-Base-Version`), o `null`. */
export function readBaseVersion(request: FastifyRequest): string | null {
  const raw = request.headers[HEADERS.syncBaseVersion.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Etiqueta legible de dispositivo, **derivada por el servidor** (sync §8.2). */
export function deviceLabel(request: FastifyRequest): string {
  const raw = request.headers['user-agent'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value.slice(0, 120) : 'desconocido';
}
