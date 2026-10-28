import type { ConfigEntry } from './config-entry.js';
import type { ConfigValue } from './config-value.js';

/**
 * Puerto **por agregado** (D6): nunca un `Repository<T>` genérico.
 *
 * Igual que §4.1, el puerto **no** recibe el alcance: el adaptador concreto lo
 * consume por ALS y aplica el predicado de tenant (D11, ADR 0007 punto 4).
 */
export interface ConfigEntryRepository {
  byKey(key: string): Promise<ConfigEntry | null>;
  /** Incluye el outbox en la **misma** transacción (§4.1, D9/D10). */
  save(entry: ConfigEntry): Promise<void>;
}

/**
 * Catálogo de claves y esquemas de la **vertical** (ADR 0007, punto 3).
 *
 * El kernel no define el catálogo ni embebe un motor de reglas (D19): la vertical
 * registra sus claves y sabe validar cada valor. El kernel lo usa **fail-closed**:
 * una clave no registrada no se puede escribir.
 */
export interface ConfigSchemaRegistry {
  /** Versión de esquema vigente para la clave, o `null` si la clave no está registrada. */
  currentVersion(key: string): number | null;
  /** `true` si `value` es válido para `(key, schemaVersion)`. */
  isValid(key: string, schemaVersion: number, value: ConfigValue): boolean;
}