import type { Clock, IdGenerator } from '@kernel/domain';
import { describe, expect, it } from 'vitest';

import { ClassSession } from '../../src/domain/class-session.js';

/** Reloj determinista del dominio (sin base ni borde). */
class FixedClock implements Clock {
  now(): Date {
    return new Date('2026-10-29T12:00:00.000Z');
  }
}

/** Generador de IDs determinista para el test. */
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

function create(): ClassSession {
  return ClassSession.create({
    tenantId: 'docente-1',
    courseId: 'curso-3-1',
    date: '2026-10-29',
    ...deps(),
  });
}

describe('ClassSession — invariantes de dominio', () => {
  it('crea la clase como `dictada`, versión 1, y emite el evento de creación', () => {
    const session = create();

    expect(session.snapshot()).toEqual({
      id: 'id-1',
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      date: '2026-10-29',
      status: 'dictada',
      cancellationReason: null,
      version: 1,
    });

    const events = session.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'class-session.created', aggregateId: 'id-1' });
  });

  it('borde: recorta `courseId` y rechaza vacío o solo espacios', () => {
    const trimmed = ClassSession.create({
      tenantId: 'd',
      courseId: '  curso  ',
      date: '2026-10-29',
      ...deps(),
    });
    expect(trimmed.courseId).toBe('curso');

    expect(() =>
      ClassSession.create({ tenantId: 'd', courseId: '   ', date: '2026-10-29', ...deps() }),
    ).toThrow();
  });

  it('borde: rechaza fechas imposibles y formatos inválidos', () => {
    for (const date of ['2026-13-01', '2026-02-30', '29-10-2026', '2026-1-1', 'nope']) {
      expect(() =>
        ClassSession.create({ tenantId: 'd', courseId: 'c', date, ...deps() }),
      ).toThrow();
    }
  });

  it('cancela con motivo: `cancelada`, motivo recortado, versión 2 y evento de cambio', () => {
    const cancelled = create().cancel({ reason: '  paro  ', ...deps() });

    expect(cancelled.snapshot()).toMatchObject({
      status: 'cancelada',
      cancellationReason: 'paro',
      version: 2,
    });
    expect(cancelled.pullEvents()).toContainEqual(
      expect.objectContaining({
        type: 'class-session.status-changed',
        payload: { from: 'dictada', to: 'cancelada', reason: 'paro' },
      }),
    );
  });

  it('borde: cancelar exige un motivo no vacío', () => {
    expect(() => create().cancel({ reason: '   ', ...deps() })).toThrow();
  });

  it('re-marca entre estados (mutable, lo exige lww) y sube la versión', () => {
    const cancelled = create().cancel({ reason: 'paro', ...deps() });
    const holiday = cancelled.markHoliday(deps());

    expect(holiday.snapshot()).toMatchObject({
      status: 'feriado',
      cancellationReason: null,
      version: 3,
    });
    expect(holiday.markNoClass(deps()).snapshot()).toMatchObject({ status: 'sin_clase', version: 4 });
  });

  it('borde: re-marcar al mismo estado es no-op (ni evento ni incremento)', () => {
    const session = create();
    session.pullEvents(); // drena el evento de creación

    const first = session.markNoClass(deps());
    expect(first.version).toBe(2);
    expect(first.pullEvents()).toHaveLength(1); // drena el evento del primer cambio

    const noop = first.markNoClass(deps());
    expect(noop).toBe(first);
    expect(noop.version).toBe(2);
    expect(noop.pullEvents()).toHaveLength(0);
  });

  it('marca feriado y sin clase sin motivo, con versión 2', () => {
    expect(create().markHoliday(deps()).snapshot()).toMatchObject({
      status: 'feriado',
      cancellationReason: null,
      version: 2,
    });
    expect(create().markNoClass(deps()).snapshot()).toMatchObject({
      status: 'sin_clase',
      cancellationReason: null,
      version: 2,
    });
  });

  it('borde: `hydrate` reconstruye sin re-emitir y valida invariantes', () => {
    const snapshot = {
      id: 'x',
      tenantId: 't',
      courseId: 'c',
      date: '2026-10-29',
      status: 'cancelada',
      cancellationReason: 'paro',
      version: 4,
    } as const;

    const hydrated = ClassSession.hydrate(snapshot);
    expect(hydrated.snapshot()).toEqual(snapshot);
    expect(hydrated.pullEvents()).toHaveLength(0);

    // `cancelada` sin motivo viola el invariante.
    expect(() => ClassSession.hydrate({ ...snapshot, cancellationReason: null })).toThrow();
    // Fecha inválida.
    expect(() => ClassSession.hydrate({ ...snapshot, date: '2026-02-30' })).toThrow();
    // Versión fuera de rango.
    expect(() => ClassSession.hydrate({ ...snapshot, version: 0 })).toThrow();
    // Estado desconocido (dato corrupto en base).
    expect(() => ClassSession.hydrate({ ...snapshot, status: 'otro' as never })).toThrow();
  });

  it('el token de versión es la forma decimal de `version` y es monótono', () => {
    const created = create();
    expect(created.versionToken).toBe('1');
    expect(created.markNoClass(deps()).versionToken).toBe('2');
  });
});
