import { randomBytes } from 'node:crypto';

import type { Clock, IdGenerator } from '@kernel/domain';

/** `Clock` de sistema (§4.1). Inyectable para testear el dominio de forma determinista. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

const MAX_SEQUENCE = 0x0fff;

let lastTimestamp = -1;
let lastSequence = 0;

function nextTimestampAndSequence(now: number): { timestamp: number; sequence: number } {
  if (now > lastTimestamp) {
    lastTimestamp = now;
    lastSequence = 0;
    return { timestamp: now, sequence: 0 };
  }

  // Mismo milisegundo (o reloj hacia atrás): avanza el contador para no perder el orden.
  let sequence = lastSequence + 1;
  let timestamp = lastTimestamp;

  if (sequence > MAX_SEQUENCE) {
    timestamp += 1;
    sequence = 0;
  }

  lastTimestamp = timestamp;
  lastSequence = sequence;
  return { timestamp, sequence };
}

function formatUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Genera un **UUIDv7** (D8): 48 bits de timestamp Unix (ms) + 4 bits de versión +
 * 12 bits de contador monótono + 62 bits aleatorios. Sin dependencias externas.
 *
 * El contador hace los IDs **monótonos** dentro del mismo milisegundo (clave para
 * ordenar eventos generados en el mismo instante).
 */
export function uuidV7(now: number = Date.now()): string {
  const { timestamp, sequence } = nextTimestampAndSequence(now);

  const bytes = new Uint8Array(randomBytes(16));

  let remaining = BigInt(timestamp);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatUuid(bytes);
}

/** `IdGenerator` con UUIDv7 generado en el dominio (D8). */
export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidV7();
  }
}