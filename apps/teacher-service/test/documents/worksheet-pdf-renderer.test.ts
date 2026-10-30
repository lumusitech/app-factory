import type { Clock } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { buildDailyWorksheet, type DailyWorksheetView } from '../../src/domain/daily-worksheet.js';
import { renderDailyWorksheetPdf } from '../../src/documents/worksheet-pdf-renderer.js';
import { DEFAULT_WORKSHEET_TEMPLATE } from '../../src/documents/worksheet-template.js';

/**
 * Render de la planilla de uso diario a PDF (ADR 0017). Bordes: **determinismo**,
 * validez del archivo, curso vacío, multipágina, cierre manual, evolución y las
 * dos disposiciones (matriz / bloque por alumno).
 */

class FixedClock implements Clock {
  constructor(private readonly date: Date) {}
  now(): Date {
    return this.date;
  }
}

const CLOCK = new FixedClock(new Date('2026-10-30T12:00:00.000Z'));

const CONTEXT = {
  school: 'EES 12',
  subject: 'Matemática',
  division: '3° 1ª',
  cycle: '2026',
  teacher: 'Pérez',
};

function decode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

function buildView(overrides: Partial<Parameters<typeof buildDailyWorksheet>[0]> = {}) {
  return buildDailyWorksheet({
    courseId: 'curso-3-1',
    period: 'C1',
    dates: ['2026-05-02', '2026-05-09'],
    roster: ['legajo-1', 'legajo-2'],
    evaluations: [
      { id: 'e1', name: 'Parcial', period: 'C1' },
      { id: 'e2', name: 'TP', period: 'C1' },
    ],
    grades: [
      { evaluationId: 'e1', studentId: 'legajo-1', value: 7 },
      { evaluationId: 'e2', studentId: 'legajo-2', value: 4 },
    ],
    trajectory: [{ period: 'C1', studentId: 'legajo-1', rating: 'TEA' }],
    attendance: [
      { date: '2026-05-02', studentId: 'legajo-1', status: 'presente' },
      { date: '2026-05-09', studentId: 'legajo-1', status: 'ausente' },
    ],
    overrides: [{ studentId: 'legajo-2', value: 8, motive: 'recuperatorio' }],
    records: [
      { studentId: 'legajo-1', evaluationId: 'e1', grade: 7, note: 'ok', occurredOn: '2026-05-10' },
    ],
    ...overrides,
  });
}

function render(
  overrides: Partial<Parameters<typeof renderDailyWorksheetPdf>[0]> = {},
): Uint8Array {
  return renderDailyWorksheetPdf({
    view: buildView(),
    template: DEFAULT_WORKSHEET_TEMPLATE,
    context: CONTEXT,
    clock: CLOCK,
    layout: 'full',
    ...overrides,
  });
}

function onlyStudent(view: DailyWorksheetView, studentId: string): DailyWorksheetView {
  return { ...view, students: view.students.filter((student) => student.studentId === studentId) };
}

describe('renderDailyWorksheetPdf (ADR 0017)', () => {
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
    expect(decode(render())).toContain('/CreationDate (D:20261030120000Z)');
    const other = render({ clock: new FixedClock(new Date('2026-10-31T08:30:00.000Z')) });
    expect(decode(other)).toContain('/CreationDate (D:20261031083000Z)');
    expect(decode(other)).not.toEqual(decode(render()));
  });

  it('layout matriz: mapea título, cabecera, período, legajo, fecha, actividad, valoración y cierre', () => {
    const pdf = decode(render());
    expect(pdf).toContain('Planilla de uso diario');
    expect(pdf).toContain('Curso: curso-3-1');
    expect(pdf).toContain('Período: C1');
    expect(pdf).toContain('EES 12');
    expect(pdf).toContain('Matemática');
    expect(pdf).toContain('(legajo-1) Tj');
    expect(pdf).toContain('(legajo-2) Tj');
    expect(pdf).toContain('(2026-05-02) Tj');
    expect(pdf).toContain('(Parcial) Tj');
    expect(pdf).toContain('(presente) Tj');
    expect(pdf).toContain('(ausente) Tj');
    expect(pdf).toContain('(TEA) Tj');
    expect(pdf).toContain('(7) Tj');
    // cierre manual marcado
    expect(pdf).toContain('(8 M) Tj');
    expect(pdf).toContain('M: nota de cierre manual');
  });

  it('layout matriz: incluye la evolución del período en el anexo', () => {
    const pdf = decode(render());
    expect(pdf).toContain('Evolución');
    expect(pdf).toContain('Parcial: 7 - ok');
  });

  it('borde: curso vacío → PDF válido sin filas', () => {
    const pdf = decode(render({ view: buildView({ roster: [] }) }));
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('Planilla de uso diario');
    expect(pdf).not.toContain('(legajo-1) Tj');
  });

  it('borde: muchas filas → multipágina (no se pierde ningún alumno)', () => {
    const roster = Array.from({ length: 60 }, (_value, index) => `legajo-${index + 1}`);
    const pdf = decode(render({ view: buildView({ roster }) }));
    // 2 páginas de matriz + 1 de anexo de evolución.
    expect(pdf).toContain('/Count 3');
    expect(pdf).toContain('(legajo-1) Tj');
    expect(pdf).toContain('(legajo-60) Tj');
  });

  it('layout bloque: rinde el seguimiento de un solo alumno', () => {
    const pdf = decode(render({ layout: 'student', view: onlyStudent(buildView(), 'legajo-1') }));
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('Alumno: legajo-1');
    expect(pdf).toContain('Asistencia');
    expect(pdf).toContain('presente');
    expect(pdf).toContain('Parcial');
    expect(pdf).toContain('TEA');
    expect(pdf).toContain('Cierre');
    expect(pdf).not.toContain('Alumno: legajo-2');
  });
});
