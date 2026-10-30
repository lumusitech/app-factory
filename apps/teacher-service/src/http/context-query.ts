import { z } from 'zod';

/**
 * Cabecera opaca compartida por los artefactos imprimibles (F-04 planilla oficial,
 * ADR 0014; F-04 planilla de uso diario, ADR 0017).
 *
 * Valores que hoy **no** se pueden derivar (escuela, materia, división, ciclo,
 * docente) viajan como **query params opacos** que la plantilla mapea
 * (`context.*`). No se modela `Curso` ni se persiste la cabecera: es una
 * limitación explícita del corte, no un olvido (ADR 0014).
 */

export const CONTEXT_VALUE_MAX_LENGTH = 200;

const CONTEXT_KEYS = ['school', 'subject', 'division', 'cycle', 'teacher'] as const;

export const contextQuery = z.object({
  school: z.string().trim().max(CONTEXT_VALUE_MAX_LENGTH).optional(),
  subject: z.string().trim().max(CONTEXT_VALUE_MAX_LENGTH).optional(),
  division: z.string().trim().max(CONTEXT_VALUE_MAX_LENGTH).optional(),
  cycle: z.string().trim().max(CONTEXT_VALUE_MAX_LENGTH).optional(),
  teacher: z.string().trim().max(CONTEXT_VALUE_MAX_LENGTH).optional(),
});

export type ContextQuery = z.infer<typeof contextQuery>;

/** Extrae solo los valores de cabecera declarados (ignora otros query params). */
export function buildContext(query: ContextQuery): Record<string, string> {
  const context: Record<string, string> = {};
  for (const key of CONTEXT_KEYS) {
    const value = query[key];
    if (typeof value === 'string') {
      context[key] = value;
    }
  }
  return context;
}
