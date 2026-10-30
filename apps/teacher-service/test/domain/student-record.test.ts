import { describe, expect, it } from 'vitest';

import type { Clock, IdGenerator } from '@kernel/domain';

import { STUDENT_RECORD_KINDS, StudentRecord } from '../../src/domain/student-record.js';

/**
 * `StudentRecord` — una entrada del registro del alumno (F-05; ADR 0015). Tests
 * de invariantes y bordes: por tipo, obligatoriedad de campos, límites de la
 * escala 1–10, fecha de calendario, id del cliente y la restricción de que
 * `evaluationId`/`grade` solo viven en `evaluacion`.
 */

class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-30T12:00:00.000Z');
  }
}

class SequenceIdGenerator implements IdGenerator {
  #value = 0;
  next(): string {
    this.#value += 1;
    return `id-${this.#value}`;
  }
}

function deps(): { clock: Clock; idGenerator: IdGenerator } {
  return { clock: new FixedClock(), idGenerator: new SequenceIdGenerator() };
}

function create(overrides: Partial<Parameters<typeof StudentRecord.create>[0]> = {}): StudentRecord {
  return StudentRecord.create({
    tenantId: 'docente-1',
    studentId: 'legajo-1',
    kind: 'observacion',
    occurredOn: '2026-10-30',
    note: 'Participa activamente.',
    ...deps(),
    ...overrides,
  });
}

describe('StudentRecord — registro del alumno (F-05, ADR 0015)', () => {
  it('crea una observación (version 1) y emite `student-record.recorded`', () => {
    const record = create();

    expect(record.snapshot()).toEqual({
      id: 'id-1',
      tenantId: 'docente-1',
      studentId: 'legajo-1',
      kind: 'observacion',
      occurredOn: '2026-10-30',
      note: 'Participa activamente.',
      category: null,
      evaluationId: null,
      grade: null,
      version: 1,
    });
    expect(record.pullEvents()[0]).toMatchObject({
      type: 'student-record.recorded',
      aggregateId: 'id-1',
    });
  });

  it('acepta el `id` del cliente (capturar offline; D8)', () => {
    expect(create({ id: 'cliente-1' }).id).toBe('cliente-1');
  });

  it('normaliza `category`, `evaluationId` y `grade` ausentes a null', () => {
    const record = create({ category: 'rendimiento' });
    expect(record.snapshot().category).toBe('rendimiento');
    expect(record.snapshot().evaluationId).toBeNull();
    expect(record.snapshot().grade).toBeNull();
  });

  it('borde: la observación exige `note` no vacía', () => {
    expect(() => create({ kind: 'observacion', note: undefined })).toThrow();
    expect(() => create({ kind: 'observacion', note: '   ' })).toThrow();
  });

  it('borde: el movimiento exige motivo (`note`) no vacío', () => {
    expect(() => create({ kind: 'movimiento', note: undefined })).toThrow();
    expect(() => create({ kind: 'movimiento', note: 'Se traslada a otra escuela.' })).not.toThrow();
  });

  it('borde: la evaluación exige `evaluationId` no vacío', () => {
    expect(() => create({ kind: 'evaluacion', note: undefined })).toThrow();
    expect(() => create({ kind: 'evaluacion', evaluationId: 'e1' })).not.toThrow();
  });

  it('borde: exige `kind`, `studentId` y una fecha de calendario válida', () => {
    expect(() => create({ kind: 'otro' })).toThrow();
    expect(() => create({ studentId: '   ' })).toThrow();
    expect(() => create({ occurredOn: '2026-13-01' })).toThrow();
    expect(() => create({ occurredOn: '30/10/2026' })).toThrow();
  });

  it('borde: la nota de una evaluación es entera 1–10 (T16)', () => {
    for (const grade of [1, 10]) {
      expect(() => create({ kind: 'evaluacion', evaluationId: 'e1', grade })).not.toThrow();
    }
    for (const grade of [0, 11, 7.5, Number.NaN]) {
      expect(() => create({ kind: 'evaluacion', evaluationId: 'e1', grade })).toThrow();
    }
  });

  it('borde: una evaluación sin nota es válida (actividad sin calificar)', () => {
    const record = create({ kind: 'evaluacion', evaluationId: 'e1', note: undefined });
    expect(record.snapshot().grade).toBeNull();
  });

  it('borde: `evaluationId`/`grade` solo viven en `evaluacion`', () => {
    expect(() => create({ kind: 'observacion', evaluationId: 'e1' })).toThrow();
    expect(() => create({ kind: 'movimiento', grade: 5 })).toThrow();
  });

  it('borde: acota la longitud de `note` y `category`', () => {
    expect(() => create({ note: 'x'.repeat(4001) })).toThrow();
    expect(() => create({ note: 'ok', category: 'x'.repeat(121) })).toThrow();
  });

  it('hidrata desde persistencia validando invariantes y sin re-emitir eventos', () => {
    const record = StudentRecord.hydrate({
      id: 'r1',
      tenantId: 'docente-1',
      studentId: 'legajo-1',
      kind: 'evaluacion',
      occurredOn: '2026-10-30',
      note: 'Corrige y reentrega.',
      category: null,
      evaluationId: 'e1',
      grade: 8,
      version: 1,
    });
    expect(record.pullEvents()).toEqual([]);
    expect(record.snapshot().grade).toBe(8);

    expect(() =>
      StudentRecord.hydrate({
        id: 'r2',
        tenantId: 'docente-1',
        studentId: 'legajo-1',
        kind: 'evaluacion',
        occurredOn: '2026-10-30',
        note: null,
        category: null,
        evaluationId: null,
        grade: null,
        version: 1,
      }),
    ).toThrow();
  });

  it('expone el conjunto de kinds válidos', () => {
    expect([...STUDENT_RECORD_KINDS]).toEqual(['observacion', 'movimiento', 'evaluacion']);
  });
});
