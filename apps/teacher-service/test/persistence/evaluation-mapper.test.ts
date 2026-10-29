import { describe, expect, it } from 'vitest';

import { Evaluation } from '../../src/domain/evaluation.js';
import { rowToSnapshot, snapshotToParams } from '../../src/persistence/evaluation-row.js';
import type { EvaluationRow } from '../../src/persistence/evaluation-row.js';

describe('mapper de Evaluation (D7: entidad de persistencia + mapper explícito)', () => {
  it('fila → snapshot → parámetros de INSERT, y vuelta por `hydrate`', () => {
    // `weight` es `numeric`: el driver lo devuelve como texto.
    const row: EvaluationRow = {
      id: 'eval-1',
      tenant_id: 'docente-1',
      course_id: 'curso-3-1',
      name: 'Parcial 1',
      period: 'C1',
      weight: '2.5000',
      version: 1,
    };

    const snapshot = rowToSnapshot(row);
    expect(snapshot).toEqual({
      id: 'eval-1',
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      name: 'Parcial 1',
      period: 'C1',
      weight: 2.5,
      version: 1,
    });

    expect(snapshotToParams(snapshot)).toEqual([
      'eval-1',
      'docente-1',
      'curso-3-1',
      'Parcial 1',
      'C1',
      2.5,
      1,
    ]);
    expect(Evaluation.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('borde: un peso entero devuelto como texto se normaliza a número', () => {
    const row: EvaluationRow = {
      id: 'eval-2',
      tenant_id: 'docente-1',
      course_id: 'curso-3-1',
      name: 'TP',
      period: 'C1',
      weight: '1',
      version: 1,
    };

    expect(rowToSnapshot(row).weight).toBe(1);
  });
});
