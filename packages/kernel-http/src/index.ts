/**
 * `@kernel/http` — adaptador de borde del kernel (D4, §4).
 *
 * Fastify + Zod: envelope, filtro de errores al catálogo del kernel, pipeline
 * Zod → JSON Schema → OpenAPI y middleware de alcance (puebla el ALS vía
 * `@kernel/scope`). **No** define rutas de dominio: la vertical las registra
 * sobre el servidor que devuelve `buildServer`.
 */
export { okEnvelope } from './envelope.js';
export { registerErrorHandling } from './error-handler.js';
export { HttpError, NotFoundError } from './errors.js';
export { sendEnvelope } from './reply.js';
export { registerProbeRoute } from './routes/probe.js';
export { registerScope } from './scope-plugin.js';
export type { ScopeResolver } from './scope-plugin.js';
export { buildServer } from './server.js';
export type { BuildServerOptions } from './server.js';
export { registerZodOpenApi } from './zod-openapi.js';
export type { OpenApiOptions } from './zod-openapi.js';