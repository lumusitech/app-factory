/** La clave de configuración no tiene el formato permitido (`kebab`/`dot`). */
export class InvalidConfigKeyError extends Error {
  constructor(readonly key: unknown) {
    super(
      'La clave de configuración debe ser kebab/dot case en minúsculas, no vacía y de hasta 120 caracteres (p. ej. "calendar.term").',
    );
    this.name = 'InvalidConfigKeyError';
  }
}

/** La clave no está registrada en el catálogo de la vertical (ADR 0007). */
export class UnknownConfigKeyError extends Error {
  constructor(readonly key: string) {
    super(
      `La clave de configuración "${key}" no está registrada en el catálogo (ConfigSchemaRegistry).`,
    );
    this.name = 'UnknownConfigKeyError';
  }
}

/** El valor no cumple el esquema vigente de la clave (ADR 0007). */
export class InvalidConfigValueError extends Error {
  constructor(
    readonly key: string,
    readonly schemaVersion: number,
  ) {
    super(
      `El valor de "${key}" no es válido para el esquema versión ${schemaVersion}.`,
    );
    this.name = 'InvalidConfigValueError';
  }
}