import { describe, expect, it } from 'vitest';

import { buildDailyWorksheet } from '../../src/domain/daily-worksheet.js';

/**
 * Vista derivada de la planilla de uso diario (ADR 0017). Bordes: orden por
 * legajo (§7.4), actividades por período, asistencia por fecha, valoración,
 * cierre (reusa F-12/ADR 0016), evolución del período, curso vacío y período sin
 * notas.
 */

const BASE = {
  courseId: 'curso-3-1',
  period: 'C1',
  dates: ['2026-05-09', '2026-05-02'],
  roster: ['legajo-2', 'legajo-1'],
  evaluations: [
    { id: 'e2', name: 'TP', period: 'C1' },
    { id: 'e1', name: 'Parcial', period: 'C1' },
    { id: 'e3', name: 'Final', period: 'C2' },
  ],
  grades: [
    { evaluationId: 'e1', studentId: 'legajo-1', value: 7 },
    { evaluationId: 'e2', studentId: 'legajo-2', value: 9 },
  ],
  trajectory: [{ period: 'C1', studentId: 'legajo-1', rating: 'TEA' as const }],
  attendance: [
    { date: '2026-05-02', studentId: 'legajo-1', status: 'presente' as const },
    { date: '2026-05-09', studentId: 'legajo-1', status: 'ausente' as const },
  ],
  overrides: [{ studentId: 'legajo-2', value: 8, motive: 'recuperatorio' }],
  records: [
    { studentId: 'legajo-1', evaluationId: 'e1', grade: 6, note: 'primera', occurredOn: '2026-05-03' },
    { studentId: 'legajo-1', evaluationId: 'e1', grade: 7, note: 'recorreccion', occurredOn: '2026-05-10' },
  ],
};

describe('buildDailyWorksheet (F-04 planilla de uso diario; ADR 0017)', () => {
  it('ordena el roster por legajo y las fechas ascendente (§7.4)', () => {
    const view = buildDailyWorksheet(BASE);
    expect(view.students.map((student) => student.studentId)).toEqual(['legajo-1', 'legajo-2']);
    expect(view.dates).toEqual(['2026-05-02', '2026-05-09']);
  });

  it('expone solo las actividades del período, ordenadas por nombre', () => {
    const view = buildDailyWorksheet(BASE);
    expect(view.activities).toEqual([
      { evaluationId: 'e1', name: 'Parcial' },
      { evaluationId: 'e2', name: 'TP' },
    ]);
  });

  it('mapea la nota por actividad del alumno (ausente ⇒ sin entrada)', () => {
    const view = buildDailyWorksheet(BASE);
    const legajo1 = view.students.find((student) => student.studentId === 'legajo-1');
    expect(legajo1?.grades['e1']).toBe(7);
    expect(legajo1?.grades['e2']).toBeUndefined();
  });

  it('deriva la asistencia por fecha', () => {
    const view = buildDailyWorksheet(BASE);
    const legajo1 = view.students.find((student) => student.studentId === 'legajo-1');
    expect(legajo1?.attendance['2026-05-02']).toBe('presente');
    expect(legajo1?.attendance['2026-05-09']).toBe('ausente');
  });

  it('incluye valoración y cierre (reusa buildPeriodClosing)', () => {
    const view = buildDailyWorksheet(BASE);
    const legajo1 = view.students.find((student) => student.studentId === 'legajo-1');
    expect(legajo1?.trajectory).toBe('TEA');
    expect(legajo1?.closing.automatic).toBe(7);
    expect(legajo1?.closing.effective).toBe(7);
    expect(legajo1?.closing.state).toBe('automatica');

    const legajo2 = view.students.find((student) => student.studentId === 'legajo-2');
    expect(legajo2?.closing.automatic).toBe(9);
    expect(legajo2?.closing.effective).toBe(8);
    expect(legajo2?.closing.state).toBe('manual');
    expect(legajo2?.closing.motive).toBe('recuperatorio');
  });

  it('incluye la evolución del período con "la última nota manda" (ADR 0015 §5)', () => {
    const view = buildDailyWorksheet(BASE);
    const legajo1 = view.students.find((student) => student.studentId === 'legajo-1');
    expect(legajo1?.evolution).toHaveLength(1);
    expect(legajo1?.evolution[0]?.grade).toBe(7);
    expect(legajo1?.evolution[0]?.note).toBe('recorreccion');
  });

  it('borde: curso sin datos → vista válida sin alumnos', () => {
    const view = buildDailyWorksheet({
      courseId: 'curso-vacio',
      period: 'C1',
      dates: [],
      roster: [],
      evaluations: [],
      grades: [],
      trajectory: [],
      attendance: [],
      overrides: [],
      records: [],
    });
    expect(view.students).toEqual([]);
    expect(view.dates).toEqual([]);
    expect(view.activities).toEqual([]);
  });

  it('borde: período sin notas → cierre automático null (nunca 0)', () => {
    const view = buildDailyWorksheet({ ...BASE, grades: [], overrides: [], records: [] });
    for (const student of view.students) {
      expect(student.closing.automatic).toBeNull();
      expect(student.closing.effective).toBeNull();
      expect(student.closing.state).toBe('automatica');
    }
  });

  it('es pura y determinista', () => {
    expect(buildDailyWorksheet(BASE)).toEqual(buildDailyWorksheet(BASE));
  });
});
