/**
 * Registro de idempotencia y *seam* de persistencia del interceptor
 * (`docs/contracts/idempotency.md` §4; ADR 0006 punto 5).
 *
 * El contrato difiere al código "el almacenamiento concreto del store" (§12):
 * acá solo vive la **forma** del registro y la operación de lectura/escritura
 * por clave. La implementación concreta es un adaptador de salida
 * (`kernel-persistence`). No es un tipo de entidad (§8): no describe agregados.
 */

/** Ventana de idempotencia (contrato de idempotencia §4): 48 h. No se re-litiga. */
export const IDEMPOTENCY_TTL_HOURS = 48;

/** Instante de expiración de un registro creado en `createdAt` (TTL de §4). */
export function idempotencyExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Registro guardado tras ejecutar una mutación protegida
 * (`docs/contracts/idempotency.md` §4/§5).
 *
 * `key` es el hash `SHA-256(userId|method|path|key)` (§3); `fingerprint` distingue
 * un payload de otro (§7); el replay devuelve `statusCode` + `body` **verbatim**.
 */
export interface IdempotencyRecord {
  readonly key: string;
  readonly fingerprint: string;
  readonly statusCode: number;
  readonly body: unknown;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/**
 * Operación de lectura/escritura por clave del store de idempotencia
 * (§12: el almacenamiento concreto es de un adaptador).
 *
 * El adaptador concreto obtiene el tenant del `ScopeContext` (D11): el puerto no
 * lo recibe, igual que los puertos de dominio (§4.1).
 */
export interface IdempotencyStore {
  /** Devuelve el registro de la clave, o `null` si no existe o venció (§4/§5). */
  find(key: string): Promise<IdempotencyRecord | null>;
  /** Guarda el registro de una ejecución ya efectuada (execute-then-store, ADR 0001). */
  save(record: IdempotencyRecord): Promise<void>;
}