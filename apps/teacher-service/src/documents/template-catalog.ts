import type { ConfigService } from '@kernel/config';

import {
  DEFAULT_OFFICIAL_SHEET_TEMPLATE,
  OFFICIAL_SHEET_TEMPLATE_KEY,
  parseOfficialSheetTemplate,
  type OfficialSheetTemplate,
} from './template.js';

/**
 * Resuelve la **plantilla vigente** de la planilla (F-04; ADR 0014).
 *
 * Orden: la entrada de `kernel-config` del tenant (dato versionado, T7/D19) si
 * existe —validada **fail-closed** contra el esquema— o, si no, el `default`
 * embebido de PBA secundaria. Cambiar provincia/año (o corregir el formulario) es
 * cambiar **dato**: **no** requiere release (T7).
 */
export interface ResolvedOfficialSheetTemplate {
  readonly template: OfficialSheetTemplate;
  readonly source: 'config' | 'default';
}

export async function resolveOfficialSheetTemplate(
  config: ConfigService,
): Promise<ResolvedOfficialSheetTemplate> {
  const entry = await config.get(OFFICIAL_SHEET_TEMPLATE_KEY);
  if (entry === null) {
    return { template: DEFAULT_OFFICIAL_SHEET_TEMPLATE, source: 'default' };
  }
  // Fail-closed: una plantilla almacenada que no cumple el esquema es un fallo.
  return { template: parseOfficialSheetTemplate(entry.value), source: 'config' };
}
