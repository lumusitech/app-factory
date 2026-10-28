import type { Clock } from '@kernel/domain';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { registerErrorHandling } from './error-handler.js';
import { registerScope } from './scope-plugin.js';
import type { ScopeResolver } from './scope-plugin.js';
import { registerZodOpenApi } from './zod-openapi.js';
import type { OpenApiOptions } from './zod-openapi.js';

export interface BuildServerOptions {
  readonly clock: Clock;
  readonly resolveScope: ScopeResolver;
  readonly openapi?: OpenApiOptions;
  readonly logger?: boolean;
}

/**
 * Composition root **manual** del kernel (D4): no hay contenedor ni request-scope
 * de un framework. El producto arma su `@kernel/http` con su `Clock` y su
 * resolver de identidad (alcance), y luego registra sus rutas.
 *
 * El orden importa: OpenAPI/Zod se registra antes que las rutas para que el
 * documento incluya sus schemas.
 */
export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await registerZodOpenApi(app, options.openapi ?? { title: 'kernel', version: '0.1.0' });
  registerErrorHandling(app, options.clock);
  registerScope(app, options.resolveScope);

  return app;
}