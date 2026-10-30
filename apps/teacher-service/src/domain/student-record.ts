import type { Clock, DomainEvent, IdGenerator } from '@kernel/domain';
import type { TenantId } from '@kernel/scope';

import { isValidCalendarDate } from './class-session.js';

/**
 * `StudentRecord` — una entrada del **registro del alumno** (F-05;
 * `docs/teacher-service-context.md` §3.1 (`Registro`); ADR 0015).
 *
 * Es un **log append-only por alumno**: cada instancia es **un hecho** con fecha
 * (`occurredOn`) del tipo `kind`:
 * - `observacion`: seguimiento global (rendimiento, dificultades, acompañamiento,
 *   salud, conducta, comunicados…); `note` obligatoria, `category` opcional.
 * - `movimiento`: el alumno deja de recibir seguimiento (traslado/baja); `note`
 *   obligatoria (el motivo).
 * - `evaluacion`: evolución de un trabajo (`evaluationId`); `note` y `grade`
 *   opcionales. **La última entrada con nota manda.**
 *
 * Es **solo creación** (inmutable): corregir un hecho es **agregar otro**. El
 * `studentId` es el **legajo interno** (T4), una referencia **opaca** y estable
 * (§7.4); sin clave foránea porque `student`/`evaluation` no existen (ADR 0010).
 * El `id` lo puede aportar el **cliente** (UUIDv7, D8) para capturar offline.
 */

export const STUDENT_RECORD_KINDS = ['observacion', 'movimiento', 'evaluacion'] as const;
export type StudentRecordKind = (typeof STUDENT_RECORD_KINDS)[number];

export const STUDENT_RECORD_ID_MAX_LENGTH = 200;
export const STUDENT_ID_MAX_LENGTH = 200;
export const STUDENT_RECORD_NOTE_MAX_LENGTH = 4000;
export const STUDENT_RECORD_CATEGORY_MAX_LENGTH = 120;
export const STUDENT_RECORD_EVALUATION_ID_MAX_LENGTH = 200;
export const STUDENT_RECORD_GRADE_MIN = 1;
export const STUDENT_RECORD_GRADE_MAX = 10;

export interface StudentRecordSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly studentId: string;
  readonly kind: StudentRecordKind;
  readonly occurredOn: string;
  readonly note: string | null;
  readonly category: string | null;
  readonly evaluationId: string | null;
  readonly grade: number | null;
  readonly version: number;
}

export interface StudentRecordCreateInput {
  readonly tenantId: TenantId;
  readonly studentId: unknown;
  readonly kind: unknown;
  readonly occurredOn: unknown;
  readonly note?: unknown;
  readonly category?: unknown;
  readonly evaluationId?: unknown;
  readonly grade?: unknown;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  /** Id opcional aportado por el cliente (UUIDv7, D8); sin él, lo genera el servidor. */
  readonly id?: unknown;
}

function normalizeId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (id === '' || id.length > STUDENT_RECORD_ID_MAX_LENGTH) {
    throw new Error(
      `El \`id\` del registro debe ser un texto no vacío de hasta ${STUDENT_RECORD_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return id;
}

function normalizeStudentId(value: unknown): string {
  const studentId = typeof value === 'string' ? value.trim() : '';
  if (studentId === '' || studentId.length > STUDENT_ID_MAX_LENGTH) {
    throw new Error(
      `El \`studentId\` (legajo) debe ser un texto no vacío de hasta ${STUDENT_ID_MAX_LENGTH} caracteres.`,
    );
  }
  return studentId;
}

function normalizeKind(value: unknown): StudentRecordKind {
  if (typeof value !== 'string' || !(STUDENT_RECORD_KINDS as readonly string[]).includes(value)) {
    throw new Error(`El \`kind\` debe ser uno de: ${STUDENT_RECORD_KINDS.join(', ')}.`);
  }
  return value as StudentRecordKind;
}

function normalizeDate(value: unknown): string {
  if (!isValidCalendarDate(value)) {
    throw new Error('La fecha del registro debe ser una fecha de calendario válida (AAAA-MM-DD).');
  }
  return value;
}

function normalizeOptionalText(value: unknown, maxLength: number, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') {
    return null;
  }
  if (text.length > maxLength) {
    throw new Error(`${label} no puede superar ${maxLength} caracteres.`);
  }
  return text;
}

function normalizeOptionalGrade(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < STUDENT_RECORD_GRADE_MIN ||
    value > STUDENT_RECORD_GRADE_MAX
  ) {
    throw new Error(
      `La nota del registro debe ser un entero entre ${STUDENT_RECORD_GRADE_MIN} y ${STUDENT_RECORD_GRADE_MAX}.`,
    );
  }
  return value;
}

interface NormalizedFields {
  readonly note: string | null;
  readonly category: string | null;
  readonly evaluationId: string | null;
  readonly grade: number | null;
}

/** Aplica las reglas propias de cada `kind` (ADR 0015, punto 3). */
function applyKindRules(kind: StudentRecordKind, fields: NormalizedFields): NormalizedFields {
  if (kind === 'evaluacion') {
    if (fields.evaluationId === null) {
      throw new Error('Una entrada de tipo `evaluacion` exige `evaluationId`.');
    }
    return fields;
  }
  if (fields.evaluationId !== null || fields.grade !== null) {
    throw new Error('`evaluationId` y `grade` solo se permiten en entradas de tipo `evaluacion`.');
  }
  if (fields.note === null) {
    throw new Error(
      kind === 'movimiento'
        ? 'Una entrada de tipo `movimiento` exige el motivo en `note`.'
        : 'Una entrada de tipo `observacion` exige `note`.',
    );
  }
  return fields;
}

function normalizeFields(input: {
  readonly kind: StudentRecordKind;
  readonly note: unknown;
  readonly category: unknown;
  readonly evaluationId: unknown;
  readonly grade: unknown;
}): NormalizedFields {
  return applyKindRules(input.kind, {
    note: normalizeOptionalText(input.note, STUDENT_RECORD_NOTE_MAX_LENGTH, 'La nota de seguimiento'),
    category: normalizeOptionalText(
      input.category,
      STUDENT_RECORD_CATEGORY_MAX_LENGTH,
      'La categoría',
    ),
    evaluationId: normalizeOptionalText(
      input.evaluationId,
      STUDENT_RECORD_EVALUATION_ID_MAX_LENGTH,
      'El `evaluationId`',
    ),
    grade: normalizeOptionalGrade(input.grade),
  });
}

export class StudentRecord {
  #events: DomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: TenantId,
    readonly studentId: string,
    readonly kind: StudentRecordKind,
    readonly occurredOn: string,
    readonly note: string | null,
    readonly category: string | null,
    readonly evaluationId: string | null,
    readonly grade: number | null,
    readonly version: number,
  ) {}

  /** Crea una entrada del registro (`version` 1) y emite `student-record.recorded`. */
  static create(input: StudentRecordCreateInput): StudentRecord {
    const id = normalizeId(input.id ?? input.idGenerator.next());
    const studentId = normalizeStudentId(input.studentId);
    const kind = normalizeKind(input.kind);
    const occurredOn = normalizeDate(input.occurredOn);
    const fields = normalizeFields({
      kind,
      note: input.note,
      category: input.category,
      evaluationId: input.evaluationId,
      grade: input.grade,
    });

    const record = new StudentRecord(
      id,
      input.tenantId,
      studentId,
      kind,
      occurredOn,
      fields.note,
      fields.category,
      fields.evaluationId,
      fields.grade,
      1,
    );

    record.#events.push({
      id: input.idGenerator.next(),
      type: 'student-record.recorded',
      aggregateId: id,
      occurredAt: input.clock.now(),
      payload: { studentId, kind, occurredOn },
    });

    return record;
  }

  /** Reconstruye desde persistencia **sin** re-emitir eventos, validando invariantes. */
  static hydrate(snapshot: StudentRecordSnapshot): StudentRecord {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('La versión de un registro debe ser un entero >= 1.');
    }
    const kind = normalizeKind(snapshot.kind);
    const fields = applyKindRules(kind, {
      note: normalizeOptionalText(
        snapshot.note,
        STUDENT_RECORD_NOTE_MAX_LENGTH,
        'La nota de seguimiento',
      ),
      category: normalizeOptionalText(
        snapshot.category,
        STUDENT_RECORD_CATEGORY_MAX_LENGTH,
        'La categoría',
      ),
      evaluationId: normalizeOptionalText(
        snapshot.evaluationId,
        STUDENT_RECORD_EVALUATION_ID_MAX_LENGTH,
        'El `evaluationId`',
      ),
      grade: normalizeOptionalGrade(snapshot.grade),
    });

    return new StudentRecord(
      normalizeId(snapshot.id),
      snapshot.tenantId,
      normalizeStudentId(snapshot.studentId),
      kind,
      normalizeDate(snapshot.occurredOn),
      fields.note,
      fields.category,
      fields.evaluationId,
      fields.grade,
      snapshot.version,
    );
  }

  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  snapshot(): StudentRecordSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      studentId: this.studentId,
      kind: this.kind,
      occurredOn: this.occurredOn,
      note: this.note,
      category: this.category,
      evaluationId: this.evaluationId,
      grade: this.grade,
      version: this.version,
    };
  }

  /** Token de versión **opaco** (sync §8.1): forma decimal del entero monótono. */
  get versionToken(): string {
    return String(this.version);
  }
}
