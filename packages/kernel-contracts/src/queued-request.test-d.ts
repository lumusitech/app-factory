import { expectTypeOf } from 'vitest';

import type {
  QueuedRequest,
  QueuedRequestMethod,
  QueuedRequestState,
} from './queued-request.js';

// El tipo TS es espejo del schema normativo (sync §7). Se fijan los campos
// obligatorios, los opcionales y las uniones cerradas.
expectTypeOf<QueuedRequestMethod>().toEqualTypeOf<'POST' | 'PUT' | 'PATCH' | 'DELETE'>();
expectTypeOf<QueuedRequestState>().toEqualTypeOf<'pending' | 'blocked'>();

expectTypeOf<QueuedRequest['method']>().toEqualTypeOf<QueuedRequestMethod>();
expectTypeOf<QueuedRequest['state']>().toEqualTypeOf<QueuedRequestState>();
expectTypeOf<QueuedRequest['order']>().toEqualTypeOf<number>();
expectTypeOf<QueuedRequest['idempotencyKey']>().toEqualTypeOf<string>();
expectTypeOf<QueuedRequest['createdAt']>().toEqualTypeOf<string>();
expectTypeOf<QueuedRequest['attempts']>().toEqualTypeOf<number>();

// Opcionales que el schema no exige.
expectTypeOf<QueuedRequest['body']>().toEqualTypeOf<Record<string, unknown> | null | undefined>();
expectTypeOf<QueuedRequest['baseVersion']>().toEqualTypeOf<string | null | undefined>();
expectTypeOf<QueuedRequest['lastAttemptAt']>().toEqualTypeOf<string | null | undefined>();

// `blockedReason` no puede faltar conceptualmente cuando `state = 'blocked'`,
// pero el schema lo expresa como opcional; el tipo lo refleja.
expectTypeOf<NonNullable<QueuedRequest['blockedReason']>['statusCode']>().toEqualTypeOf<number>();
expectTypeOf<NonNullable<QueuedRequest['blockedReason']>['message']>().toEqualTypeOf<string>();
