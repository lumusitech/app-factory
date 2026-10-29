import { expectTypeOf } from 'vitest';

import type { Envelope, ErrorEnvelope } from './envelope.js';
import type { OverwriteSignal } from './sync.js';

// Contratos de tipo del envelope de transporte (§1.1, §5; idempotency §10,
// sync §9). El camino feliz no alcanza: se fijan las formas exactas. `sync`
// (opcional) lleva la señal de sobrescritura de `lww` (ADR 0008).
expectTypeOf<Envelope<{ id: string }>>().toEqualTypeOf<{
  readonly statusCode: number;
  readonly data: { id: string };
  readonly timestamp: string;
  readonly sync?: OverwriteSignal;
}>();

expectTypeOf<Envelope<number>['sync']>().toEqualTypeOf<OverwriteSignal | undefined>();

expectTypeOf<ErrorEnvelope>().toEqualTypeOf<{
  readonly statusCode: number;
  readonly message: string;
  readonly error: string | null;
  readonly timestamp: string;
}>();

// `data` es genérico: el envelope no conoce tipos de entidad (§8).
expectTypeOf<Envelope<number>['data']>().toEqualTypeOf<number>();
