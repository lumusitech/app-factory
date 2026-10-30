import type { Clock } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { buildOfficialSheet } from '../../src/domain/official-sheet.js';
import { renderOfficialSheetPdf } from '../../src/documents/pdf-renderer.js';
import { DEFAULT_OFFICIAL_SHEET_TEMPLATE } from '../../src/documents/template.js';

/**
 * Render de la planilla a PDF (F-04, ADR 0014). Bordes: **determinismo**,
 * validez del archivo, curso vacío, multipágina y límites. El PDF no se
 * comprime, así que el texto aparece literal en los bytes (los decodificamos en
 * Latin-1/WinAnsi para verificar).
 */

class FixedClock implements Clock {
  constructor(private readonly date: Date) {}
  now(): Date {
    return this.date;
  }
}

const CLOCK = new FixedClock(new Date('2026-10-29T12:00:00.000Z'));

function decode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

function buildView(overrides: Partial<Parameters<typeof buildOfficialSheet>[0]> = {}) {
  return buildOfficialSheet({
    courseId: 'curso-3-1',
    periods: ['C1', 'C2'],
    roster: ['legajo-1'],
    evaluations: [{ id: 'e1', period: 'C1', weight: 1 }],
    grades: [{ evaluationId: 'e1', studentId: 'legajo-1', value: 7 }],
    trajectory: [{ period: 'C1', studentId: 'legajo-1', rating: 'TEA' }],
    attendance: [{ studentId: 'legajo-1', status: 'ausente' }],
    ...overrides,
  });
}

function render(
  overrides: Partial<Parameters<typeof renderOfficialSheetPdf>[0]> = {},
): Uint8Array {
  return renderOfficialSheetPdf({
    view: buildView(),
    template: DEFAULT_OFFICIAL_SHEET_TEMPLATE,
    context: {
      school: 'EES 12',
      subject: 'Matemática',
      division: '3° 1ª',
      cycle: '2026',
      teacher: 'Pérez',
    },
    clock: CLOCK,
    ...overrides,
  });
}

describe('renderOfficialSheetPdf (F-04, ADR 0014)', () => {
  it('produce un PDF válido (cabecera y fin)', () => {
    const pdf = decode(render());
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(pdf).toContain('xref');
  });

  it('es determinista: mismo input + mismo reloj → mismos bytes', () => {
    expect(render()).toEqual(render());
  });

  it('el reloj fija el /CreationDate (sin fecha no determinista)', () => {
    expect(decode(render())).toContain('/CreationDate (D:20261029120000Z)');
    const other = render({ clock: new FixedClock(new Date('2026-10-30T08:30:00.000Z')) });
    expect(decode(other)).toContain('/CreationDate (D:20261030083000Z)');
    expect(decode(other)).not.toEqual(decode(render()));
  });

  it('mapea el título, la cabecera opaca, el legajo y las celdas derivadas', () => {
    const pdf = decode(render());
    expect(pdf).toContain('Planilla oficial');
    expect(pdf).toContain('Curso: curso-3-1');
    expect(pdf).toContain('EES 12');
    expect(pdf).toContain('Matemática');
    expect(pdf).toContain('(legajo-1) Tj');
    expect(pdf).toContain('(7) Tj');
    expect(pdf).toContain('(TEA) Tj');
    // columna de asistencia: una ausencia
    expect(pdf).toContain('(1) Tj');
  });

  it('borde: curso vacío → PDF válido, con título y sin filas', () => {
    const pdf = decode(render({ view: buildView({ roster: [] }) }));
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('Planilla oficial');
    expect(pdf).not.toContain('(legajo-1) Tj');
  });

  it('borde: muchas filas → multipágina (no se pierde ningún alumno)', () => {
    const roster = Array.from({ length: 60 }, (_value, index) => `legajo-${index + 1}`);
    const pdf = decode(render({ view: buildView({ roster }) }));
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('(legajo-1) Tj');
    expect(pdf).toContain('(legajo-60) Tj');
  });

  it('borde: respeta los límites de la escala 1 y 10 (T16)', () => {
    const view = buildView({
      roster: ['legajo-1'],
      evaluations: [
        { id: 'e1', period: 'C1', weight: 1 },
        { id: 'e2', period: 'C2', weight: 1 },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 1 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 10 },
      ],
    });
    const pdf = decode(render({ view }));
    expect(pdf).toContain('(1) Tj');
    expect(pdf).toContain('(10) Tj');
  });
});
