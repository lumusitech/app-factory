import type { ConfigSchemaRegistry, ConfigValue } from '@kernel/config';

import {
  OFFICIAL_SHEET_TEMPLATE_KEY,
  parseOfficialSheetTemplate,
} from '../documents/template.js';
import {
  WORKSHEET_TEMPLATE_KEY,
  parseWorksheetTemplate,
} from '../documents/worksheet-template.js';

/**
 * Catálogo de claves y esquemas de la vertical (ADR 0007, D19).
 *
 * El kernel **no** define el catálogo: la vertical registra sus claves y sabe
 * validar cada valor. Está **fail-closed**: una clave no registrada no se puede
 * escribir.
 *
 * F-04 registra la clave de la **plantilla de la planilla** (T7, ADR 0014): es un
 * **dato versionado** por `(jurisdicción, nivel, año)`, validado por
 * `parseOfficialSheetTemplate`, el mismo esquema que valida la plantilla en la
 * **lectura**. Cambiar provincia/año no requiere release.
 *
 * La planilla de uso diario (ADR 0017) registra su propia clave de plantilla,
 * validada por `parseWorksheetTemplate` con el mismo criterio.
 */

const OFFICIAL_SHEET_TEMPLATE_VERSION = 1;
const WORKSHEET_TEMPLATE_VERSION = 1;

interface CatalogEntry {
  readonly version: number;
  readonly isValid: (value: ConfigValue) => boolean;
}

function isValidOfficialSheetTemplate(value: ConfigValue): boolean {
  try {
    parseOfficialSheetTemplate(value);
    return true;
  } catch {
    return false;
  }
}

function isValidWorksheetTemplate(value: ConfigValue): boolean {
  try {
    parseWorksheetTemplate(value);
    return true;
  } catch {
    return false;
  }
}

const catalog = new Map<string, CatalogEntry>([
  [
    OFFICIAL_SHEET_TEMPLATE_KEY,
    { version: OFFICIAL_SHEET_TEMPLATE_VERSION, isValid: isValidOfficialSheetTemplate },
  ],
  [
    WORKSHEET_TEMPLATE_KEY,
    { version: WORKSHEET_TEMPLATE_VERSION, isValid: isValidWorksheetTemplate },
  ],
]);

export function createConfigRegistry(): ConfigSchemaRegistry {
  return {
    currentVersion: (key) => catalog.get(key)?.version ?? null,
    isValid: (key, schemaVersion, value) => {
      const entry = catalog.get(key);
      return entry !== undefined && entry.version === schemaVersion && entry.isValid(value);
    },
  };
}
