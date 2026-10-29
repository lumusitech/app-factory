import { CONNECTIVITY_PROBE_VALUE, HEADERS } from '@kernel/contracts';

import type { ConnectivityProbe, ProbeSpec } from '../ports/connectivity.js';
import type { Transport } from '../ports/transport.js';

/**
 * Conectividad de referencia: hace el *probe* por el mismo `Transport` con el
 * bypass `X-Connectivity-Probe` (sync §6). El endpoint es un **parámetro**
 * (`ProbeSpec`), no un valor hardcodeado (§1.2).
 */
export class TransportConnectivityProbe implements ConnectivityProbe {
  constructor(
    private readonly transport: Transport,
    private readonly spec: ProbeSpec,
  ) {}

  async check(): Promise<boolean> {
    const result = await this.transport.send({
      method: this.spec.method ?? 'GET',
      path: this.spec.path,
      headers: { [HEADERS.connectivityProbe]: CONNECTIVITY_PROBE_VALUE },
    });
    return result.kind === 'response' && result.statusCode >= 200 && result.statusCode < 300;
  }
}
