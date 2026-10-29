import { describe, expect, it } from 'vitest';

import { StubTransport, envelope, networkError, response } from '../../test/support/fakes.js';
import { TransportConnectivityProbe } from './transport-connectivity.js';

describe('TransportConnectivityProbe (sync §6)', () => {
  it('usa el `ProbeSpec` inyectado con el bypass X-Connectivity-Probe', async () => {
    const transport = new StubTransport(() => response(200, envelope({ status: 'ok' })));
    const probe = new TransportConnectivityProbe(transport, { path: '/probe', method: 'HEAD' });

    const online = await probe.check();

    expect(online).toBe(true);
    expect(transport.requests[0]).toMatchObject({
      method: 'HEAD',
      path: '/probe',
      headers: { 'X-Connectivity-Probe': 'true' },
    });
  });

  it('es `false` ante un status no 2xx', async () => {
    const transport = new StubTransport(() => response(503, envelope({})));
    const probe = new TransportConnectivityProbe(transport, { path: '/probe' });
    expect(await probe.check()).toBe(false);
  });

  it('es `false` ante un error de red', async () => {
    const transport = new StubTransport(() => networkError());
    const probe = new TransportConnectivityProbe(transport, { path: '/probe' });
    expect(await probe.check()).toBe(false);
  });
});
