import { describe, expect, it } from 'vitest';

import { buildPeriodClosing } from '../../src/domain/period-closing-view.js';

/**
 * F-12 (§3.5, T6): la nota de cierre es una **vista derivada**. Estos tests fijan
 * el **promedio simple** (ignora actividades sin nota y el `weight`), el
 * **override manual** (gana, con estado y motivo), el **redondeo half-up**, la
 * **evolución** consumida del registro ("la última nota manda") y los bordes
 * (período sin evaluaciones, roster vacío, límites 1/10). No aplica umbrales
 * (§7.8/§7.9/T16).
 */

function build(overrides: Partial<Parameters<typeof buildPeriodClosing>[0]> = {}) {
  return buildPeriodClosing({
    courseId: 'curso-3-1',
    period: 'C1',
    roster: ['legajo-1'],
    evaluations: [],
    grades: [],
    overrides: [],
    records: [],
    ...overrides,
  });
}

describe('buildPeriodClosing — cierre de período como vista derivada (F-12, ADR 0016)', () => {
  it('deriva la nota automática como promedio simple de las notas del período', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1' },
        { id: 'e2', period: 'C1' },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 4 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 8 },
      ],
    });
    expect(view.students[0]).toMatchObject({
      studentId: 'legajo-1',
      automatic: 6,
      effective: 6,
      state: 'automatica',
      motive: null,
    });
  });

  it('borde: ignora las actividades sin nota y las de otros períodos', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1' },
        { id: 'e2', period: 'C1' },
        { id: 'e3', period: 'C2' },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 9 },
        // e2 (C1) sin nota del alumno: no arrastra; e3 es de C2: se ignora.
        { evaluationId: 'e3', studentId: 'legajo-1', value: 1 },
      ],
    });
    expect(view.students[0]).toMatchObject({ automatic: 9, effective: 9 });
  });

  it('redondea half-up a entero (7,5 → 8; 7,0 → 7)', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1' },
        { id: 'e2', period: 'C1' },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 7 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 8 },
      ],
    });
    expect(view.students[0]?.automatic).toBe(8);
  });

  it('borde: el override manual gana y se ve con estado `manual` y motivo', () => {
    const view = build({
      evaluations: [{ id: 'e1', period: 'C1' }],
      grades: [{ evaluationId: 'e1', studentId: 'legajo-1', value: 4 }],
      overrides: [{ studentId: 'legajo-1', value: 7, motive: 'Recuperó el TP' }],
    });
    expect(view.students[0]).toMatchObject({
      automatic: 4,
      effective: 7,
      state: 'manual',
      motive: 'Recuperó el TP',
    });
  });

  it('borde: override sin nota automática y estado `manual`', () => {
    const view = build({
      overrides: [{ studentId: 'legajo-1', value: 6, motive: null }],
    });
    expect(view.students[0]).toMatchObject({ automatic: null, effective: 6, state: 'manual', motive: null });
  });

  it('borde: alumno del roster sin datos → automática y efectiva null (nunca 0)', () => {
    const view = build({ roster: ['legajo-1'] });
    expect(view.students[0]).toMatchObject({
      studentId: 'legajo-1',
      automatic: null,
      effective: null,
      state: 'automatica',
      motive: null,
      evolution: [],
    });
  });

  it('borde: período sin evaluaciones → sin notas (no rompe)', () => {
    const view = build({
      roster: ['legajo-1'],
      evaluations: [{ id: 'e1', period: 'C2' }],
      grades: [{ evaluationId: 'e1', studentId: 'legajo-1', value: 9 }],
    });
    expect(view.students[0]?.automatic).toBeNull();
  });

  it('borde: respeta los límites de la escala 1 y 10 (T16)', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1' },
        { id: 'e2', period: 'C1' },
      ],
      grades: [
        { evaluationId: 'e1', studentId: 'legajo-1', value: 1 },
        { evaluationId: 'e2', studentId: 'legajo-1', value: 10 },
      ],
    });
    expect(view.students[0]?.automatic).toBe(6);
  });

  it('consume la evolución del registro: la última entrada con nota manda', () => {
    const view = build({
      evaluations: [
        { id: 'e1', period: 'C1' },
        { id: 'odd', period: 'C2' },
      ],
      records: [
        { studentId: 'legajo-1', evaluationId: 'e1', grade: 4, note: 'Primera entrega', occurredOn: '2026-05-10' },
        { studentId: 'legajo-1', evaluationId: 'e1', grade: 8, note: 'Reentrega', occurredOn: '2026-05-20' },
        // Otro período: no entra en la evolución del cierre de C1.
        { studentId: 'legajo-1', evaluationId: 'odd', grade: 10, note: 'C2', occurredOn: '2026-09-01' },
      ],
    });
    expect(view.students[0]?.evolution).toEqual([
      { evaluationId: 'e1', grade: 8, note: 'Reentrega', occurredOn: '2026-05-20' },
    ]);
  });

  it('borde: evolución con solo notas (sin grade) muestra la última observación', () => {
    const view = build({
      evaluations: [{ id: 'e1', period: 'C1' }],
      records: [
        { studentId: 'legajo-1', evaluationId: 'e1', grade: null, note: 'Falta entregar', occurredOn: '2026-05-10' },
        { studentId: 'legajo-1', evaluationId: 'e1', grade: null, note: 'Entregó incompleto', occurredOn: '2026-05-15' },
      ],
    });
    expect(view.students[0]?.evolution).toEqual([
      { evaluationId: 'e1', grade: null, note: 'Entregó incompleto', occurredOn: '2026-05-15' },
    ]);
  });

  it('ordena el roster por legajo (nunca por posición; §7.4) y deduplica', () => {
    const view = build({ roster: ['legajo-9', 'legajo-2', 'legajo-9', 'legajo-1'] });
    expect(view.students.map((student) => student.studentId)).toEqual([
      'legajo-1',
      'legajo-2',
      'legajo-9',
    ]);
  });

  it('borde: roster vacío → sin filas', () => {
    expect(build({ roster: [] })).toEqual({
      courseId: 'curso-3-1',
      period: 'C1',
      students: [],
    });
  });

  it('la vista no calcula la condición: no aplica umbrales (§7.8/§7.9/T16)', () => {
    const view = build({
      evaluations: [{ id: 'e1', period: 'C1' }],
      grades: [{ evaluationId: 'e1', studentId: 'legajo-1', value: 3 }],
    });
    expect(view.students[0]).not.toHaveProperty('condition');
    expect(view.students[0]).not.toHaveProperty('approved');
  });
});
