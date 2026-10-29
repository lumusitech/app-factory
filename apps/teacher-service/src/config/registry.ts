import type { ConfigSchemaRegistry } from '@kernel/config';

/**
 * Catálogo de claves y esquemas de la vertical (ADR 0007, D19).
 *
 * El kernel **no** define el catálogo: la vertical registra sus claves
 * (`calendar.term`, `grading.thresholds`, …) y sabe validar cada valor. Este
 * stub arranca **vacío** y por lo tanto **fail-closed**: ninguna clave se puede
 * escribir hasta registrarla acá.
 */
export function createConfigRegistry(): ConfigSchemaRegistry {
  // Extension point: registrá cada clave con su versión vigente y su validador.
  // Ejemplo:
  //   const catalog = new Map<string, { version: number; isValid: (value: ConfigValue) => boolean }>([
  //     ['grading.thresholds', { version: 1, isValid: (value) => typeof value === 'object' }],
  //   ]);
  //   return {
  //     currentVersion: (key) => catalog.get(key)?.version ?? null,
  //     isValid: (key, schemaVersion, value) =>
  //       catalog.get(key)?.version === schemaVersion && (catalog.get(key)?.isValid(value) ?? false),
  //   };
  return {
    currentVersion: () => null,
    isValid: () => false,
  };
}
