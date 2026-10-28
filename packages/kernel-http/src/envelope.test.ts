import { describe, expect, it } from 'vitest';

import { FixedClock } from '../test/support/fakes.js';
import { okEnvelope } from './envelope.js';

describe('okEnvelope', () => {
  it('arma {statusCode, data, timestamp} con el timestamp del Clock', () => {
    const clock = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));

    expect(okEnvelope({ id: 'n1' }, clock)).toEqual({
      statusCode: 200,
      data: { id: 'n1' },
      timestamp: '2026-10-28T12:00:00.000Z',
    });
  });

  it('permite fijar el statusCode (p. ej. 201)', () => {
    const clock = new FixedClock(new Date('2026-10-28T12:00:00.000Z'));
    expect(okEnvelope({ id: 'n1' }, clock, 201).statusCode).toBe(201);
  });
});