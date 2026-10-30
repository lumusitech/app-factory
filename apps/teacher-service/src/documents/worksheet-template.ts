import type { ConfigValue } from '@kernel/config';

/**
 * Plantilla de la planilla de uso diario: **contrato de salida** y **dato
 * versionado** (T7; `docs/teacher-service-context.md` §6; ADR 0017).
 *
 * A diferencia de la planilla oficial (columnas exactas por período; ADR 0014),
 * la hoja de trabajo tiene columnas **dinámicas** (fechas de asistencia y
 * actividades del período), así que la plantilla declara **secciones** (qué se
 * muestra y con qué etiqueta) + cabecera + título; las columnas dentro de cada
 * sección se derivan. Se guarda como entrada de `kernel-config` (D19, ADR 0007)
 * bajo la clave de abajo, validada **fail-closed**. El `default` embebido es
 * **dato** de la vertical: la salida funciona *out-of-the-box* y el override por
 * config cumple T7. El **período** es un parámetro **opaco** del pedido, no un
 * valor de la plantilla: no se hardcodea `C1`/`C2` (§7.8).
 */

/** Clave de `kernel-config` de la plantilla de uso diario (ADR 0017). */
export const WORKSHEET_TEMPLATE_KEY = 'document.template.worksheet-pba-secondary-2026';

export const WORKSHEET_SECTION_KINDS = [
  'attendance',
  'activities',
  'trajectory',
  'closing',
  'evolution',
] as const;

export type WorksheetSectionKind = (typeof WORKSHEET_SECTION_KINDS)[number];

/** Campo de cabecera: etiqueta visible + origen del valor (`context.<nombre>`). */
export interface WorksheetHeaderField {
  readonly label: string;
  readonly source: string;
}

/** Sección de la hoja: qué se muestra (las columnas se derivan del pedido). */
export interface WorksheetSection {
  readonly kind: WorksheetSectionKind;
  readonly label: string;
}

export interface WorksheetTemplate {
  readonly id: string;
  readonly jurisdiction: string;
  readonly level: string;
  readonly year: number;
  readonly title: string;
  readonly header: readonly WorksheetHeaderField[];
  readonly sections: readonly WorksheetSection[];
}

/** La plantilla almacenada no cumple el esquema (fail-closed; ADR 0017). */
export class InvalidWorksheetTemplateError extends Error {
  constructor() {
    super('La plantilla de la planilla de uso diario no cumple el esquema esperado (ADR 0017).');
    this.name = 'InvalidWorksheetTemplateError';
  }
}

function isConfigObject(value: unknown): value is { readonly [key: string]: ConfigValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isSectionKind(value: unknown): value is WorksheetSectionKind {
  return typeof value === 'string' && (WORKSHEET_SECTION_KINDS as readonly string[]).includes(value);
}

function parseHeaderField(value: ConfigValue): WorksheetHeaderField {
  if (!isConfigObject(value) || !isNonEmptyString(value.label) || !isNonEmptyString(value.source)) {
    throw new InvalidWorksheetTemplateError();
  }
  return { label: value.label.trim(), source: value.source.trim() };
}

function parseSection(value: ConfigValue): WorksheetSection {
  if (!isConfigObject(value) || !isSectionKind(value.kind) || !isNonEmptyString(value.label)) {
    throw new InvalidWorksheetTemplateError();
  }
  return { kind: value.kind, label: value.label.trim() };
}

/** Parsea y valida un valor de config como plantilla; lanza si no cumple (fail-closed). */
export function parseWorksheetTemplate(value: unknown): WorksheetTemplate {
  if (
    !isConfigObject(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.jurisdiction) ||
    !isNonEmptyString(value.level) ||
    !isPositiveInteger(value.year) ||
    !isNonEmptyString(value.title) ||
    !Array.isArray(value.header) ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0
  ) {
    throw new InvalidWorksheetTemplateError();
  }

  return {
    id: value.id.trim(),
    jurisdiction: value.jurisdiction.trim(),
    level: value.level.trim(),
    year: value.year,
    title: value.title.trim(),
    header: value.header.map(parseHeaderField),
    sections: value.sections.map(parseSection),
  };
}

/**
 * Plantilla de uso diario PBA secundaria 2026 embebida (dato de la vertical; ADR
 * 0017). Se usa cuando el tenant no tiene su propia entrada de config; el override
 * por config cumple T7.
 */
export const DEFAULT_WORKSHEET_TEMPLATE: WorksheetTemplate = parseWorksheetTemplate({
  id: 'worksheet-pba-secondary-2026',
  jurisdiction: 'PBA',
  level: 'secundaria',
  year: 2026,
  title: 'Planilla de uso diario - Educación Secundaria (PBA)',
  header: [
    { label: 'Escuela', source: 'context.school' },
    { label: 'Materia', source: 'context.subject' },
    { label: 'Curso / división', source: 'context.division' },
    { label: 'Ciclo lectivo', source: 'context.cycle' },
    { label: 'Docente', source: 'context.teacher' },
  ],
  sections: [
    { kind: 'attendance', label: 'Asistencia' },
    { kind: 'activities', label: 'Actividades del período' },
    { kind: 'trajectory', label: 'Valoración TEA/TEP/TED' },
    { kind: 'closing', label: 'Cierre' },
    { kind: 'evolution', label: 'Evolución' },
  ],
});
