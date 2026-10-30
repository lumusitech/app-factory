import { describe, expect, it } from 'vitest';

import { buildOfficialSheet } from '../../src/domain/official-sheet.js';

/**
 * F-04 (§3.5, T6): la **planilla** es una vista derivada de notas + valoraciones
 * + asistencias. Estos tests fijan el **mapeo de campos** y los **bordes**
 * (promedio ponderado, redondeo half-up, curso vacío, límites 1/10, orden por
 * legajo). No prueban el "camino feliz" solamente (CONTRIBUTING §8).
 */

const PERIODS = ['C1', 'C2'] as const;

function build(overrides: Partial<Parameters<typeof buildOfficialSheet>[0]> = {}) {
  return buildOfficialSheet({
    courseId: 'curso-3-1',
    periods: [...PERIODS],
    roster: ['legajo-1'],
    evaluations: [],
    grades: [],
    trajectory: [],
    attendance: [],
    ...overrides,
  });
}

describe('buildOfficialSheet — planilla como vista derivada (F-04, ADR 0014)', () => {
  it('deriva la nota del período como promedio ponderado por el peso de la evaluación', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1', weight: 1 },
        { id: 'e2', period: 'C1', weight: 3 },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 4 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 8 },
      ],
    });

    // (1*4 + 3*8) / 4 = 7
    expect(view.students[0]?.periods[0]).toEqual({ period: 'C1', grade: 7, trajectory: null });
  });

  it('redondea half-up a entero (7,5 → 8; 7,0 → 7)', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1', weight: 1 },
        { id: 'e2', period: 'C1', weight: 1 },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 7 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 8 },
      ],
    });
    expect(view.students[0]?.periods[0]?.grade).toBe(8);
  });

  it('borde: período sin evaluaciones con nota → celda vacía (null), nunca 0', () => {
    const view = build({ roster: ['legajo-1'] });
    expect(view.students[0]?.periods).toEqual([
      { period: 'C1', grade: null, trajectory: null },
      { period: 'C2', grade: null, trajectory: null },
    ]);
  });

  it('borde: ignora evaluaciones de otros períodos al promediar', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1', weight: 1 },
        { id: 'e2', period: 'C2', weight: 1 },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 2 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 10 },
      ],
    });
    expect(view.students[0]?.periods).toEqual([
      { period: 'C1', grade: 2, trajectory: null },
      { period: 'C2', grade: 10, trajectory: null },
    ]);
  });

  it('borde: promedia solo las evaluaciones que tienen nota del alumno', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1', weight: 1 },
        { id: 'e2', period: 'C1', weight: 10 },
      ],
      // el alumno no tiene nota de e2 (peso 10): no arrastra la nota
      grades: [{ evaluationId: 'e1', studentId: 'legajo-1', value: 9 }],
    });
    expect(view.students[0]?.periods[0]?.grade).toBe(9);
  });

  it('borde: respeta los límites de la escala 1 y 10 (T16)', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1', weight: 1 },
        { id: 'e2', period: 'C2', weight: 1 },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 1 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 10 },
      ],
    });
    expect(view.students[0]?.periods[0]?.grade).toBe(1);
    expect(view.students[0]?.periods[1]?.grade).toBe(10);
  });

  it('mapea la valoración preliminar por período (TEA/TEP/TED)', () => {
    const view = build({
      roster: ['legajo-1'],
      trajectory: [{ period: 'C2', studentId: 'legajo-1', rating: 'TEP' }],
    });
    expect(view.students[0]?.periods[0]?.trajectory).toBeNull();
    expect(view.students[0]?.periods[1]?.trajectory).toBe('TEP');
  });

  it('cuenta asistencias por estado, incluyendo los cinco estados', () => {
    const view = build({
      roster: ['legajo-1'],
      attendance: [
        { studentId: 'legajo-1', status: 'presente' },
        { studentId: 'legajo-1', status: 'presente' },
        { studentId: 'legajo-1', status: 'ausente' },
        { studentId: 'legajo-1', status: 'tarde' },
        { studentId: 'legajo-1', status: 'justificada' },
        { studentId: 'legajo-1', status: 'retirado' },
      ],
    });
    expect(view.students[0]?.attendance).toEqual({
      presente: 2,
      ausente: 1,
      tarde: 1,
      justificada: 1,
      retirado: 1,
    });
  });

  it('borde: curso sin datos → roster vacío, sin filas', () => {
    const view = build({ roster: [] });
    expect(view).toEqual({ courseId: 'curso-3-1', periods: ['C1', 'C2'], students: [] });
  });

  it('ordena el roster por legajo (nunca por posición; §7.4) y deduplica', () => {
    const view = build({ roster: ['legajo-9', 'legajo-2', 'legajo-9', 'legajo-1'] });
    expect(view.students.map((student) => student.studentId)).toEqual([
      'legajo-1',
      'legajo-2',
      'legajo-9',
    ]);
  });

  it('la vista no calcula aprobado/desaprobado: no aplica umbrales (§7.8/T16)', () => {
    const view = build({
      roster: ['legajo-1'],
      evaluations: [{ id: 'e1', period: 'C1', weight: 1 }],
      grades: [{ evaluationId: 'e1', studentId: 'legajo-1', value: 3 }],
    });
    expect(view.students[0]).not.toHaveProperty('condition');
    expect(view.students[0]?.periods[0]).not.toHaveProperty('approved');
  });
});
