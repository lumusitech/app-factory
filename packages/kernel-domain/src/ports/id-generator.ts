/**
 * Puerto de generación de identificadores (D8).
 *
 * Los IDs se generan en el **dominio** (UUIDv7), no por la base: así el agregado
 * se construye completo en memoria y puede emitir eventos consistentes antes del
 * `INSERT`. La implementación concreta vive en un adaptador de salida
 * (`kernel-persistence`); este paquete es TypeScript puro, CERO dependencias (D5).
 */
export interface IdGenerator {
  next(): string;
}
