import type { ConfigService } from '@kernel/config';

import {
  DEFAULT_WORKSHEET_TEMPLATE,
  WORKSHEET_TEMPLATE_KEY,
  parseWorksheetTemplate,
  type WorksheetTemplate,
} from './worksheet-template.js';

/**
 * Resuelve la **plantilla vigente** de la planilla de uso diario (ADR 0017).
 *
 * Orden: la entrada de `kernel-config` del tenant (dato versionado, T7/D19) si
 * existe —validada **fail-closed** contra el esquema— o, si no, el `default`
 * embebido de PBA secundaria. Cambiar el layout (título, cabecera, secciones) es
 * cambiar **dato**: **no** requiere release (T7).
 */
export interface ResolvedWorksheetTemplate {
  readonly template: WorksheetTemplate;
  readonly source: 'config' | 'default';
}

export async function resolveWorksheetTemplate(
  config: ConfigService,
): Promise<ResolvedWorksheetTemplate> {
  const entry = await config.get(WORKSHEET_TEMPLATE_KEY);
  if (entry === null) {
    return { template: DEFAULT_WORKSHEET_TEMPLATE, source: 'default' };
  }
  // Fail-closed: una plantilla almacenada que no cumple el esquema es un fallo.
  return { template: parseWorksheetTemplate(entry.value), source: 'config' };
}
