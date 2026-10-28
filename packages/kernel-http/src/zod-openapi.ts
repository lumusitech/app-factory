import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

export interface OpenApiOptions {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

/**
 * Pipeline **Zod → JSON Schema → OpenAPI** (D4).
 *
 * El schema Zod es la única fuente: el type provider lo convierte a JSON Schema
 * para validar/serializar y `@fastify/swagger` lo publica. No hay decoradores
 * paralelos ni tipos de entidad exportados (§8).
 */
export async function registerZodOpenApi(
  app: FastifyInstance,
  options: OpenApiOptions,
): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: options.title,
        version: options.version,
        ...(options.description === undefined ? {} : { description: options.description }),
      },
    },
    transform: jsonSchemaTransform,
  });
}