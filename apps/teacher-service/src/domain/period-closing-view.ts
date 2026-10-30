import { roundHalfUp } from './official-sheet.js';

/**
 * Cierre de período como **vista derivada** (F-12; `docs/teacher-service-context.md`
 * §3.5, T6; ADR 0016).
 *
 * La nota de cierre **no** se persiste: se deriva, en memoria, de las notas
 * vigentes (F-02), del **override manual** (el agregado `PeriodClosing`) y de la
 * **evolución** del registro (F-05, ADR 0015). Esta capa es **pura** (sin
 * frameworks, D5).
 *
 * Por `(curso, período, alumno)`:
 * - **automática** = promedio **simple** de las notas vigentes de las evaluaciones
 *   **del período** (las actividades sin nota se ignoran; `weight` no se usa,
 *   ADR 0015 §7), redondeado a entero **half-up** (T16);
 * - **efectiva** = override manual si existe, si no la automática;
 * - **estado** = `manual` si hay override, `automatica` si no;
 * - **evolución** = por trabajo del período, la **última entrada con nota** del
 *   registro (ADR 0015 §5, "la última nota manda").
 *
 * La vista **no** aplica umbrales: no calcula aprobado/intensificación (§7.8/
 * §7.9/T16). `studentId` es el **legajo** (§7.4); el roster se ordena por legajo.
 */

export type ClosingState = 'automatica' | 'manual';

export interface PeriodClosingEvolutionEntry {
  readonly evaluationId: string;
  readonly grade: number | null;
  readonly note: string | null;
  readonly occurredOn: string;
}

export interface PeriodClosingStudentRow {
  readonly studentId: string;
  readonly automatic: number | null;
  readonly effective: number | null;
  readonly state: ClosingState;
  readonly motive: string | null;
  readonly evolution: readonly PeriodClosingEvolutionEntry[];
}

export interface PeriodClosingView {
  readonly courseId: string;
  readonly period: string;
  readonly students: readonly PeriodClosingStudentRow[];
}

export interface PeriodClosingEvaluationData {
  readonly id: string;
  readonly period: string;
}

export interface PeriodClosingGradeData {
  readonly evaluationId: string;
  readonly studentId: string;
  readonly value: number;
}

export interface PeriodClosingOverrideData {
  readonly studentId: string;
  readonly value: number;
  readonly motive: string | null;
}

/** Entrada `kind='evaluacion'` del registro (`StudentRecord`, F-05). */
export interface PeriodClosingRecordData {
  readonly studentId: string;
  readonly evaluationId: string;
  readonly grade: number | null;
  readonly note: string | null;
  readonly occurredOn: string;
}

export interface PeriodClosingBuildInput {
  readonly courseId: string;
  readonly period: string;
  readonly roster: readonly string[];
  readonly evaluations: readonly PeriodClosingEvaluationData[];
  readonly grades: readonly PeriodClosingGradeData[];
  readonly overrides: readonly PeriodClosingOverrideData[];
  readonly records: readonly PeriodClosingRecordData[];
}

/**
 * Promedio simple de las notas del período (ignorando las actividades sin nota).
 * Sin ninguna nota, devuelve `null` (celda vacía; **nunca** 0).
 */
function simpleAverage(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return roundHalfUp(sum / values.length);
}

/**
 * Evolución por trabajo: la **última entrada con nota** del registro (la
 * recorrección manda, ADR 0015 §5); si no hay ninguna con nota, la última
 * entrada. Ordenada por fecha y luego por trabajo.
 */
function buildEvolution(
  studentId: string,
  periodEvaluationIds: ReadonlySet<string>,
  records: readonly PeriodClosingRecordData[],
): readonly PeriodClosingEvolutionEntry[] {
  const bestGraded = new Map<string, PeriodClosingRecordData>();
  const bestAny = new Map<string, PeriodClosingRecordData>();

  for (const record of records) {
    if (record.studentId !== studentId || !periodEvaluationIds.has(record.evaluationId)) {
      continue;
    }
    const any = bestAny.get(record.evaluationId);
    if (any === undefined || record.occurredOn >= any.occurredOn) {
      bestAny.set(record.evaluationId, record);
    }
    if (record.grade !== null) {
      const graded = bestGraded.get(record.evaluationId);
      if (graded === undefined || record.occurredOn >= graded.occurredOn) {
        bestGraded.set(record.evaluationId, record);
      }
    }
  }

  return [...bestAny.keys()]
    .map((evaluationId): PeriodClosingEvolutionEntry => {
      const chosen = bestGraded.get(evaluationId) ?? bestAny.get(evaluationId);
      return {
        evaluationId,
        grade: chosen?.grade ?? null,
        note: chosen?.note ?? null,
        occurredOn: chosen?.occurredOn ?? '',
      };
    })
    .sort((a, b) =>
      a.occurredOn < b.occurredOn
        ? -1
        : a.occurredOn > b.occurredOn
          ? 1
          : a.evaluationId < b.evaluationId
            ? -1
            : a.evaluationId > b.evaluationId
              ? 1
              : 0,
    );
}

/** Construye la vista derivada del cierre (pura, determinista). */
export function buildPeriodClosing(input: PeriodClosingBuildInput): PeriodClosingView {
  const periodEvaluationIds = new Set(
    input.evaluations.filter((evaluation) => evaluation.period === input.period).map((e) => e.id),
  );

  const gradesByStudent = new Map<string, number[]>();
  for (const grade of input.grades) {
    if (!periodEvaluationIds.has(grade.evaluationId)) {
      continue;
    }
    const list = gradesByStudent.get(grade.studentId);
    if (list === undefined) {
      gradesByStudent.set(grade.studentId, [grade.value]);
    } else {
      list.push(grade.value);
    }
  }

  const overrideByStudent = new Map<string, PeriodClosingOverrideData>();
  for (const override of input.overrides) {
    overrideByStudent.set(override.studentId, override);
  }

  const roster = [...new Set(input.roster)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const students = roster.map((studentId): PeriodClosingStudentRow => {
    const automatic = simpleAverage(gradesByStudent.get(studentId) ?? []);
    const override = overrideByStudent.get(studentId);
    return {
      studentId,
      automatic,
      effective: override?.value ?? automatic,
      state: override === undefined ? 'automatica' : 'manual',
      motive: override?.motive ?? null,
      evolution: buildEvolution(studentId, periodEvaluationIds, input.records),
    };
  });

  return { courseId: input.courseId, period: input.period, students };
}
