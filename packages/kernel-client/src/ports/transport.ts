import type { QueuedRequestMethod } from '@kernel/contracts';

/** Métodos que el transporte del cliente puede emitir. */
export type HttpMethod = QueuedRequestMethod | 'GET' | 'HEAD';

export interface TransportRequest {
  readonly method: HttpMethod;
  /** Ruta enrutada, sin query string en el caso de las mutaciones (sync §7). */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Record<string, unknown> | null;
}

/** Respuesta HTTP observada (cualquier status). */
export interface TransportResponse {
  readonly kind: 'response';
  readonly statusCode: number;
  /** Body crudo (envelope del kernel, o lo que devuelva el endpoint). */
  readonly body: unknown;
}

/** Fallo indeterminado: timeout, conexión caída, respuesta truncada (sync §4). */
export interface TransportNetworkError {
  readonly kind: 'network-error';
  readonly error?: unknown;
}

export type TransportResult = TransportResponse | TransportNetworkError;

/**
 * Puerto de transporte (D14, §1.2): el cliente **no** usa `fetch` ni ningún API
 * de navegador. Un adaptador puede envolver `fetch`, una app Android su propio
 * cliente, y los tests `fastify.inject()` — sin navegador real (D4).
 */
export interface Transport {
  send(request: TransportRequest): Promise<TransportResult>;
}
