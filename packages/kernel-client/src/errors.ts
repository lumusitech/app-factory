/**
 * Errores del cliente offline. **No** son errores del borde: el cliente nunca se
 * apoya en el catálogo HTTP del servidor para su lógica local.
 */

/** Violación de la precondición de encolado (sync §1). */
export class QueuePreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueuePreconditionError';
  }
}

/** La caché GET no pudo resolver la lectura (sin red y sin entrada válida). */
export class CacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}
