import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OFFICIAL_SHEET_TEMPLATE,
  InvalidOfficialSheetTemplateError,
  officialSheetTemplatePeriods,
  parseOfficialSheetTemplate,
} from '../../src/documents/template.js';

/**
 * La plantilla es un **dato versionado** con esquema propio (T7, D19, ADR 0014).
 * Estos tests fijan la validación **fail-closed** y el `default` embebido.
 */

const VALID = {
  id: 'tpl-1',
  jurisdiction: 'PBA',
  level: 'secundaria',
  year: 2026,
  title: 'Planilla',
  header: [{ label: 'Escuela', source: 'context.school' }],
  columns: [{ kind: 'grade', label: 'Nota', period: 'C1' }],
};

describe('parseOfficialSheetTemplate (fail-closed; ADR 0014)', () => {
  it('parsea una plantilla válida y recorta los textos', () => {
    const template = parseOfficialSheetTemplate({ ...VALID, title: '  Planilla  ' });
    expect(template.title).toBe('Planilla');
    expect(template.year).toBe(2026);
  });

  it('el default embebido es válido y tiene dos períodos (C1, C2)', () => {
    expect(officialSheetTemplatePeriods(DEFAULT_OFFICIAL_SHEET_TEMPLATE)).toEqual(['C1', 'C2']);
    expect(DEFAULT_OFFICIAL_SHEET_TEMPLATE.columns.length).toBeGreaterThan(0);
  });

  it('borde: rechaza valores que no son objeto, arrays y nulos', () => {
    for (const value of [null, 'x', 3, true, [], [VALID]]) {
      expect(() => parseOfficialSheetTemplate(value)).toThrow(InvalidOfficialSheetTemplateError);
    }
  });

  it('borde: exige id, jurisdicción, nivel, año entero y título', () => {
    expect(() => parseOfficialSheetTemplate({ ...VALID, id: '   ' })).toThrow(
      InvalidOfficialSheetTemplateError,
    );
    expect(() => parseOfficialSheetTemplate({ ...VALID, year: 0 })).toThrow(
      InvalidOfficialSheetTemplateError,
    );
    expect(() => parseOfficialSheetTemplate({ ...VALID, year: 2026.5 })).toThrow(
      InvalidOfficialSheetTemplateError,
    );
    expect(() => parseOfficialSheetTemplate({ ...VALID, title: '' })).toThrow(
      InvalidOfficialSheetTemplateError,
    );
  });

  it('borde: rechaza una plantilla sin columnas', () => {
    expect(() => parseOfficialSheetTemplate({ ...VALID, columns: [] })).toThrow(
      InvalidOfficialSheetTemplateError,
    );
  });

  it('borde: rechaza una columna de tipo desconocido', () => {
    expect(() =>
      parseOfficialSheetTemplate({ ...VALID, columns: [{ kind: 'otro', label: 'X' }] }),
    ).toThrow(InvalidOfficialSheetTemplateError);
  });

  it('borde: rechaza una columna de nota sin período', () => {
    expect(() =>
      parseOfficialSheetTemplate({ ...VALID, columns: [{ kind: 'grade', label: 'Nota' }] }),
    ).toThrow(InvalidOfficialSheetTemplateError);
  });

  it('borde: rechaza asistencia con un estado fuera del enum (§3.4)', () => {
    expect(() =>
      parseOfficialSheetTemplate({
        ...VALID,
        columns: [{ kind: 'attendance', label: 'Faltas', status: 'falto' }],
      }),
    ).toThrow(InvalidOfficialSheetTemplateError);
  });

  it('borde: exige label y source no vacíos en la cabecera', () => {
    expect(() =>
      parseOfficialSheetTemplate({ ...VALID, header: [{ label: 'Escuela', source: '' }] }),
    ).toThrow(InvalidOfficialSheetTemplateError);
  });

  it('deriva los períodos distintos en orden de aparición', () => {
    const template = parseOfficialSheetTemplate({
      ...VALID,
      columns: [
        { kind: 'grade', label: 'N C2', period: 'C2' },
        { kind: 'grade', label: 'N C2 bis', period: 'C2' },
        { kind: 'grade', label: 'N C1', period: 'C1' },
        { kind: 'attendance', label: 'Faltas', status: 'ausente' },
      ],
    });
    expect(officialSheetTemplatePeriods(template)).toEqual(['C2', 'C1']);
  });
});
