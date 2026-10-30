import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKSHEET_TEMPLATE,
  InvalidWorksheetTemplateError,
  WORKSHEET_SECTION_KINDS,
  parseWorksheetTemplate,
} from '../../src/documents/worksheet-template.js';

/**
 * La plantilla de la planilla de uso diario es un **dato versionado** con esquema
 * propio (T7, D19, ADR 0007/0014/0017). Estos tests fijan la validación
 * **fail-closed** y el `default` embebido.
 */

const VALID = {
  id: 'tpl-1',
  jurisdiction: 'PBA',
  level: 'secundaria',
  year: 2026,
  title: 'Planilla',
  header: [{ label: 'Escuela', source: 'context.school' }],
  sections: [{ kind: 'attendance', label: 'Asistencia' }],
};

describe('parseWorksheetTemplate (fail-closed; ADR 0017)', () => {
  it('parsea una plantilla válida y recorta los textos', () => {
    const template = parseWorksheetTemplate({ ...VALID, title: '  Planilla  ' });
    expect(template.title).toBe('Planilla');
    expect(template.year).toBe(2026);
  });

  it('el default embebido es válido y trae las cinco secciones', () => {
    expect(DEFAULT_WORKSHEET_TEMPLATE.sections.map((section) => section.kind)).toEqual([
      ...WORKSHEET_SECTION_KINDS,
    ]);
  });

  it('borde: rechaza valores que no son objeto, arrays y nulos', () => {
    for (const value of [null, 'x', 3, true, [], [VALID]]) {
      expect(() => parseWorksheetTemplate(value)).toThrow(InvalidWorksheetTemplateError);
    }
  });

  it('borde: exige id, jurisdicción, nivel, año entero y título', () => {
    expect(() => parseWorksheetTemplate({ ...VALID, id: '   ' })).toThrow(
      InvalidWorksheetTemplateError,
    );
    expect(() => parseWorksheetTemplate({ ...VALID, year: 0 })).toThrow(
      InvalidWorksheetTemplateError,
    );
    expect(() => parseWorksheetTemplate({ ...VALID, year: 2026.5 })).toThrow(
      InvalidWorksheetTemplateError,
    );
    expect(() => parseWorksheetTemplate({ ...VALID, title: '' })).toThrow(
      InvalidWorksheetTemplateError,
    );
  });

  it('borde: rechaza una plantilla sin secciones', () => {
    expect(() => parseWorksheetTemplate({ ...VALID, sections: [] })).toThrow(
      InvalidWorksheetTemplateError,
    );
  });

  it('borde: rechaza una sección de tipo desconocido', () => {
    expect(() =>
      parseWorksheetTemplate({ ...VALID, sections: [{ kind: 'otro', label: 'X' }] }),
    ).toThrow(InvalidWorksheetTemplateError);
  });

  it('borde: rechaza una sección sin etiqueta', () => {
    expect(() =>
      parseWorksheetTemplate({ ...VALID, sections: [{ kind: 'attendance', label: '  ' }] }),
    ).toThrow(InvalidWorksheetTemplateError);
  });

  it('borde: exige label y source no vacíos en la cabecera', () => {
    expect(() =>
      parseWorksheetTemplate({ ...VALID, header: [{ label: 'Escuela', source: '' }] }),
    ).toThrow(InvalidWorksheetTemplateError);
  });
});
