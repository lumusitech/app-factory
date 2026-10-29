import { describe, expect, it } from 'vitest';

import {
  CONNECTIVITY_PROBE_VALUE,
  HEADERS,
  OFFLINE_REPLAY_VALUE,
  isConnectivityProbe,
} from './headers.js';

describe('HEADERS', () => {
  it('usa los nombres normativos del contrato de idempotencia §9', () => {
    expect(HEADERS.idempotencyKey).toBe('Idempotency-Key');
    expect(HEADERS.offlineReplay).toBe('X-Offline-Replay');
    expect(HEADERS.connectivityProbe).toBe('X-Connectivity-Probe');
  });

  it('agrega el header del token de versión de sync (sync §8.1, ADR 0008)', () => {
    expect(HEADERS.syncBaseVersion).toBe('X-Sync-Base-Version');
    expect(OFFLINE_REPLAY_VALUE).toBe('true');
  });
});

describe('isConnectivityProbe', () => {
  it('reconoce `true` sin importar el caso ni los espacios (idempotency §9)', () => {
    expect(isConnectivityProbe('true')).toBe(true);
    expect(isConnectivityProbe('TRUE')).toBe(true);
    expect(isConnectivityProbe(' true ')).toBe(true);
  });

  it('bordes: ausente, vacío, `false`, `1` y valores parecidos no son probe', () => {
    expect(isConnectivityProbe(undefined)).toBe(false);
    expect(isConnectivityProbe('')).toBe(false);
    expect(isConnectivityProbe('   ')).toBe(false);
    expect(isConnectivityProbe('false')).toBe(false);
    expect(isConnectivityProbe('1')).toBe(false);
    expect(isConnectivityProbe('trueish')).toBe(false);
  });

  it('el valor canónico es `true` en minúscula', () => {
    expect(CONNECTIVITY_PROBE_VALUE).toBe('true');
  });
});
