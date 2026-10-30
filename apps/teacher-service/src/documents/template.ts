import type { ConfigValue } from '@kernel/config';

import { ATTENDANCE_STATUSES, type AttendanceStatus } from '../domain/class-attendance.js';

/**
 * Plantilla de la planilla oficial: **contrato de salida** y **dato versionado**
 * (`layout` + `mapeo de campos`), identificado por `(jurisdicción, nivel, año)`
 * (T7; `docs/teacher-service-context.md` §6; ADR 0014).
 *
 * La plantilla se guarda como entrada de `kernel-config` (D19, ADR 0007) bajo la
 * clave de abajo, y se valida **fail-closed** contra este esquema. El `default`
 * embebido es **dato** de la vertical, no lógica: la salida funciona
 * *out-of-the-box* y el override por config cumple T7 (cambiar provincia/año no
 * requiere release). Los períodos (`C1`/`C2`) viven **acá**, en el dato, y no en
 * el código (§7.8).
 */

/** Clave de `kernel-config` de la plantilla PBA secundaria 2026 (ADR 0014). */
export const OFFICIAL_SHEET_TEMPLATE_KEY = 'document.template.pba-secondary-2026';

/** Campo de cabecera: etiqueta visible + origen del valor (`context.<nombre>`). */
export interface OfficialSheetHeaderField {
  readonly label: string;
  readonly source: string;
}

/**
 * Columna de la planilla. `grade`/`trajectory` referencian un **período** (clave
 * opaca); `attendance` cuenta un **estado** de asistencia.
 */
export type OfficialSheetColumn =
  | { readonly kind: 'grade'; readonly label: string; readonly period: string }
  | { readonly kind: 'trajectory'; readonly label: string; readonly period: string }
  | { readonly kind: 'attendance'; readonly label: string; readonly status: AttendanceStatus };

export interface OfficialSheetTemplate {
  readonly id: string;
  readonly jurisdiction: string;
  readonly level: string;
  readonly year: number;
  readonly title: string;
  readonly header: readonly OfficialSheetHeaderField[];
  readonly columns: readonly OfficialSheetColumn[];
}

/** La plantilla almacenada no cumple el esquema (fail-closed; ADR 0014). */
export class InvalidOfficialSheetTemplateError extends Error {
  constructor() {
    super('La plantilla de la planilla no cumple el esquema esperado (ADR 0014).');
    this.name = 'InvalidOfficialSheetTemplateError';
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

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

function parseHeaderField(value: ConfigValue): OfficialSheetHeaderField {
  if (!isConfigObject(value) || !isNonEmptyString(value.label) || !isNonEmptyString(value.source)) {
    throw new InvalidOfficialSheetTemplateError();
  }
  return { label: value.label.trim(), source: value.source.trim() };
}

function parseColumn(value: ConfigValue): OfficialSheetColumn {
  if (!isConfigObject(value) || !isNonEmptyString(value.label)) {
    throw new InvalidOfficialSheetTemplateError();
  }
  const label = value.label.trim();
  if (value.kind === 'grade' || value.kind === 'trajectory') {
    if (!isNonEmptyString(value.period)) {
      throw new InvalidOfficialSheetTemplateError();
    }
    return { kind: value.kind, label, period: value.period.trim() };
  }
  if (value.kind === 'attendance') {
    if (!isAttendanceStatus(value.status)) {
      throw new InvalidOfficialSheetTemplateError();
    }
    return { kind: 'attendance', label, status: value.status };
  }
  throw new InvalidOfficialSheetTemplateError();
}

/** Parsea y valida un valor de config como plantilla; lanza si no cumple (fail-closed). */
export function parseOfficialSheetTemplate(value: unknown): OfficialSheetTemplate {
  if (
    !isConfigObject(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.jurisdiction) ||
    !isNonEmptyString(value.level) ||
    !isPositiveInteger(value.year) ||
    !isNonEmptyString(value.title) ||
    !Array.isArray(value.header) ||
    !Array.isArray(value.columns) ||
    value.columns.length === 0
  ) {
    throw new InvalidOfficialSheetTemplateError();
  }

  return {
    id: value.id.trim(),
    jurisdiction: value.jurisdiction.trim(),
    level: value.level.trim(),
    year: value.year,
    title: value.title.trim(),
    header: value.header.map(parseHeaderField),
    columns: value.columns.map(parseColumn),
  };
}

/** Períodos de la plantilla (claves distintas, en orden de aparición). */
export function officialSheetTemplatePeriods(template: OfficialSheetTemplate): string[] {
  const periods: string[] = [];
  for (const column of template.columns) {
    if ((column.kind === 'grade' || column.kind === 'trajectory') && !periods.includes(column.period)) {
      periods.push(column.period);
    }
  }
  return periods;
}

/**
 * Plantilla PBA secundaria 2026 embebida (dato de la vertical; ADR 0014). Se usa
 * cuando el tenant no tiene su propia entrada de config; el override por config
 * cumple T7.
 */
export const DEFAULT_OFFICIAL_SHEET_TEMPLATE: OfficialSheetTemplate = parseOfficialSheetTemplate({
  id: 'pba-secondary-2026',
  jurisdiction: 'PBA',
  level: 'secundaria',
  year: 2026,
  title: 'Planilla oficial - Educación Secundaria (PBA)',
  header: [
    { label: 'Escuela', source: 'context.school' },
    { label: 'Materia', source: 'context.subject' },
    { label: 'Curso / división', source: 'context.division' },
    { label: 'Ciclo lectivo', source: 'context.cycle' },
    { label: 'Docente', source: 'context.teacher' },
  ],
  columns: [
    { kind: 'trajectory', label: 'Valoración 1° cuatrimestre', period: 'C1' },
    { kind: 'grade', label: 'Nota 1° cuatrimestre', period: 'C1' },
    { kind: 'trajectory', label: 'Valoración 2° cuatrimestre', period: 'C2' },
    { kind: 'grade', label: 'Nota 2° cuatrimestre', period: 'C2' },
    { kind: 'attendance', label: 'Ausencias', status: 'ausente' },
  ],
});
