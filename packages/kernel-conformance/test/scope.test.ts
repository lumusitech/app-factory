import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness } from './support/harness.js';
import type { ConformanceHarness } from './support/harness.js';

describe('alcance, extremo a extremo (scope.md §10)', () => {
  let harness: ConformanceHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('consulta sin alcance: falla cerrada (SCOPE_MISSING) y no ejecuta la query', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: 'A' },
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    const noScope = await harness.app.inject({ method: 'GET', url: `/notes/${id}` });

    expect(noScope.statusCode).toBe(500);
    expect(noScope.json()).toMatchObject({ error: 'SCOPE_MISSING' });
  });

  it('lectura cross-tenant: no devuelve datos de otro tenant (filtro de aplicación)', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/notes',
      headers: { 'x-tenant': 'tenant-a' },
      payload: { title: 'Privada de A' },
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    const own = await harness.app.inject({
      method: 'GET',
      url: `/notes/${id}`,
      headers: { 'x-tenant': 'tenant-a' },
    });
    expect(own.statusCode).toBe(200);

    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/notes/${id}`,
      headers: { 'x-tenant': 'tenant-b' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('el sync escribe en el tenant del alcance (la vertical pone el header en su transporte)', async () => {
    harness.injectTransport.headers['x-tenant'] = 'tenant-b';

    await harness.client.enqueue({
      method: 'POST',
      path: '/notes',
      body: { title: 'De B' },
      idempotencyKey: 'scope-1',
    });
    await harness.client.flush();

    const { rows } = await harness.executor.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM conformance_note',
    );
    expect(rows[0]?.tenant_id).toBe('tenant-b');
  });
});
