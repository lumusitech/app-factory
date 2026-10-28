import { createHash } from 'node:crypto';

export interface IdempotencyKeyInput {
  readonly userId: string;
  readonly method: string;
  readonly path: string;
  readonly key: string;
}

/**
 * Clave del registro: `SHA-256(userId|method|path|key)` en **hex minúscula**
 * (contrato de idempotencia §3; ADR 0001 punto 5).
 *
 * `method` va en mayúsculas, `path` es la **ruta enrutada** (sin query string) y
 * `key` se recorta de espacios en los extremos. La composición es verbatim de
 * §1.1: **no** incluye el tenant (limitación documentada de ADR 0001).
 */
export function computeIdempotencyKey(input: IdempotencyKeyInput): string {
  const material = [input.userId, input.method.toUpperCase(), input.path, input.key.trim()].join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/**
 * Huella de la request que distingue un payload de otro (§7).
 *
 * Canonicaliza el JSON (claves ordenadas) para que un reintento con el mismo
 * contenido no produzca un `409` falso por el orden de las claves.
 */
export function computeFingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(body ?? null)), 'utf8').digest('hex');
}