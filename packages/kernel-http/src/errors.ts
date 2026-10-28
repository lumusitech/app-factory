import type { ErrorCode } from '@kernel/contracts';
import { ERROR_STATUS } from '@kernel/contracts';

/**
 * Error de borde con un código del catálogo del kernel (ADR 0005).
 *
 * La vertical puede lanzarlo desde sus casos de uso; el filtro de errores lo
 * traduce al envelope de error. Las **reglas de negocio** no viven acá (§6): solo
 * la forma de reportar un fallo en el transporte.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, statusCode: number = ERROR_STATUS[code]) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** El recurso pedido no existe (404). */
export class NotFoundError extends HttpError {
  constructor(message = 'Recurso no encontrado.') {
    super('NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}