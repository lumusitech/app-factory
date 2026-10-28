/**
 * Error del alcance (scope.md §6.2). Se lanza cuando una consulta con datos de
 * tenant se ejecuta **sin** `ScopeContext` activo: el default es **fail-closed**
 * (negar, nunca filtrar de más).
 */
export class ScopeMissingError extends Error {
  constructor(
    message = 'No hay un ScopeContext activo: se requiere alcance para acceder a datos de tenant (scope.md §6.2).',
  ) {
    super(message);
    this.name = 'ScopeMissingError';
  }
}