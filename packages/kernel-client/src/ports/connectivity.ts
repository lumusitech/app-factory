/**
 * Spec del endpoint de *probe* (sync §6). Es un **parámetro**, no un valor
 * hardcodeado: el anti-patrón auditado (§1.2) fijaba el endpoint de probe dentro
 * del motor offline.
 */
export interface ProbeSpec {
  readonly path: string;
  readonly method?: 'GET' | 'HEAD';
}

/**
 * Conectividad del cliente (parametrizada, §4). `check()` sirve para decidir
 * **cuándo** disparar el flush; su resultado **no** crea ni modifica items (sync
 * §6). La implementación de referencia usa el mismo puerto `Transport` con el
 * bypass `X-Connectivity-Probe`.
 */
export interface ConnectivityProbe {
  check(): Promise<boolean>;
}
