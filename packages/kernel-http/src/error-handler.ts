import type { ErrorEnvelope } from '@kernel/contracts';
import { ERROR_CODES } from '@kernel/contracts';
import type { Clock } from '@kernel/domain';
import { ScopeMissingError } from '@kernel/scope';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { HttpError, NotFoundError } from './errors.js';

function errorEnvelope(
  clock: Clock,
  statusCode: number,
  message: string,
  code: string | null,
): ErrorEnvelope {
  return { statusCode, message, error: code, timestamp: clock.now().toISOString() };
}

interface MappedError {
  readonly statusCode: number;
  readonly code: string | null;
  readonly message: string;
}

/**
 * Filtro de errores del borde (D4, §4).
 *
 * Traduce a envelope de error con el catálogo de `kernel-contracts`:
 * - validación Zod/Fastify → `400 VALIDATION_ERROR`;
 * - `ScopeMissingError` → `500 SCOPE_MISSING` (scope.md §6.2);
 * - `HttpError` → su código/status;
 * - cualquier otro → `500 INTERNAL_ERROR` **sin** filtrar detalles internos.
 */
function mapError(error: unknown): MappedError {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof ScopeMissingError) {
    return {
      statusCode: 500,
      code: ERROR_CODES.SCOPE_MISSING,
      message: 'La operación requiere alcance y no hay un ScopeContext activo.',
    };
  }
  if (error instanceof ZodError || isValidationError(error)) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'La request no es válida.',
    };
  }
  return { statusCode: 500, code: ERROR_CODES.INTERNAL_ERROR, message: 'Error interno.' };
}

function isValidationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'validation' in error;
}

export function registerErrorHandling(app: FastifyInstance, clock: Clock): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(
        errorEnvelope(
          clock,
          404,
          `Ruta no encontrada: ${request.method} ${request.url}`,
          ERROR_CODES.NOT_FOUND,
        ),
      );
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);

    if (mapped.statusCode >= 500) {
      // Un error inesperado deja rastro para diagnóstico; el cliente ve el envelope.
      request.log.error({ err: error }, 'kernel-http: error no controlado');
    }

    void reply
      .code(mapped.statusCode)
      .send(errorEnvelope(clock, mapped.statusCode, mapped.message, mapped.code));
  });
}

export { NotFoundError };