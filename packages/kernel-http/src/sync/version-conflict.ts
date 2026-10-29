import type { OverwriteSignal, SyncPolicy } from '@kernel/contracts';
import { ERROR_CODES } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';

import { HttpError } from '../errors.js';

/**
 * Detección y resolución del conflicto de versión de sync (sync §8; ADR 0002 y
 * ADR 0006 difirieron esta mecánica a la fase 3). El kernel **no mergea**: detecta
 * la escritura obsoleta y la resuelve según la **política explícita de la
 * vertical**.
 *
 * El `baseVersion` y la versión vigente son **tokens opacos** (sync §8.1): el
 * kernel los compara como strings, nunca interpreta su formato — su forma es
 * decisión del modelo de datos de la vertical.
 */

export interface VersionConflictInput {
  /** Token que envió el cliente (`X-Sync-Base-Version`); `null`/vacío si no versiona. */
  readonly baseVersion: string | null | undefined;
  /** Token de la versión vigente en el servidor. */
  readonly currentVersion: string;
}

/** `true` si la escritura es obsoleta: el cliente partió de una versión distinta. */
export function hasVersionConflict(input: VersionConflictInput): boolean {
  const base = input.baseVersion;
  if (base === null || base === undefined || base === '') {
    return false;
  }
  return base !== input.currentVersion;
}

export interface ResolveConflictInput extends VersionConflictInput {
  readonly policy: SyncPolicy;
  /** Actor que resuelve (derivado por el servidor, sync §8.2). */
  readonly actor: string;
  /** Etiqueta legible de dispositivo/sesión (derivada por el servidor). */
  readonly deviceLabel: string;
  readonly clock: Clock;
}

export type ConflictResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'lww'; readonly signal: OverwriteSignal };

/**
 * Decide qué hacer con una escritura (sync §8.2): sin conflicto → `none`;
 * conflicto bajo `blocked` → el llamador responde `409`; conflicto bajo `lww` →
 * el llamador aplica y devuelve el envelope con la señal de sobrescritura.
 */
export function resolveVersionConflict(input: ResolveConflictInput): ConflictResolution {
  if (!hasVersionConflict(input)) {
    return { kind: 'none' };
  }
  if (input.policy === 'blocked') {
    return { kind: 'blocked' };
  }
  return {
    kind: 'lww',
    signal: {
      // La versión que la escritura entrante pisó (la vigente antes de aplicarla).
      previousVersion: input.currentVersion,
      actor: input.actor,
      deviceLabel: input.deviceLabel,
      at: input.clock.now().toISOString(),
    },
  };
}

/** Error de borde para la política `blocked` (sync §8.2): `409` con el catálogo. */
export function syncVersionConflictError(): HttpError {
  return new HttpError(
    ERROR_CODES.SYNC_VERSION_CONFLICT,
    'Escritura obsoleta: la entidad cambió desde que se capturó offline.',
    409,
  );
}
