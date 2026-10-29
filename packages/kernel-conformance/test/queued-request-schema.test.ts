import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from './support/harness.js';
import type { ConformanceHarness } from './support/harness.js';

const require = createRequire(import.meta.url);

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

let validate: ValidateFunction;

beforeAll(() => {
  // Se valida contra el schema **publicado** por `kernel-contracts` (sync §7).
  const schema: unknown = JSON.parse(
    readFileSync(require.resolve('@kernel/contracts/queued-request.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value: string) => ISO_DATE_TIME.test(value),
  });
  validate = ajv.compile(schema as object);
});

describe('QueuedRequest producido por el cliente valida contra el schema normativo', () => {
  let harness: ConformanceHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('un item `pending` real del cliente valida (sync §7)', async () => {
    const item = await harness.client.enqueue({
      method: 'PATCH',
      path: '/notes/abc',
      body: { title: 'Cambio' },
      idempotencyKey: 'op-1',
      baseVersion: 'v3',
    });

    expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
  });

  it('un item `blocked` real del cliente valida (con `blockedReason`)', async () => {
    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: '' },
      idempotencyKey: 'op-2',
    });
    await harness.client.flush();

    const [item] = await harness.client.list();

    expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
    expect(item?.state).toBe('blocked');
  });
});
