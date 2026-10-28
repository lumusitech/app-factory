import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IdempotencyRecord, IdempotencyStore } from '@kernel/contracts';
import {
  ERROR_CODES,
  HEADERS,
  idempotencyExpiry,
  isConnectivityProbe,
} from '@kernel/contracts';
import type { Clock } from '@kernel/domain';
import { getScope } from '@kernel/scope';

import { HttpError } from '../errors.js';
import { computeFingerprint, computeIdempotencyKey } from './key.js';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface IdempotencyOptions {
  readonly store: IdempotencyStore;
  readonly clock: Clock;
  /** Observa los fallos del store (fail-open, contrato §8). Por defecto, silencio. */
  readonly onStoreFailure?: (error: unknown, phase: 'read' | 'write') => void;
}

interface PendingExecution {
  readonly key: string;
  readonly fingerprint: string;
}

/**
 * Interceptor de idempotencia (contrato de idempotencia; ADR 0001; fase 2).
 *
 * Precondición (§1): **mutación** + header `Idempotency-Key` + **usuario
 * autenticado**. Si falta cualquiera, la request se ejecuta sin protección y no
 * se registra nada.
 *
 * Semántica:
 * - *hit* en el store → replay del `statusCode` + `body` almacenados, **sin**
 *   re-ejecutar el handler (§5);
 * - mismo payload → replay; payload distinto → `409` (§7);
 * - misma clave en vuelo **en este proceso** → `409` (§6; ADR 0001 descartó un
 *   estado `pending` durable, así que la detección es por proceso);
 * - fallo del store → **fail-open**: se ejecuta igual (§8).
 *
 * El registro se guarda en `onSend`, después de ejecutar la mutación
 * (*execute-then-store*): la ventana ejecución→guardado es la limitación
 * aceptada en ADR 0001.
 */
export function registerIdempotency(app: FastifyInstance, options: IdempotencyOptions): void {
  const inFlight = new Set<string>();
  const pending = new WeakMap<FastifyRequest, PendingExecution>();
  const resolvedPayloads = new WeakMap<FastifyRequest, unknown>();
  const reportFailure = options.onStoreFailure ?? (() => undefined);

  app.addHook('preHandler', async (request, reply) => {
    if (!MUTATIONS.has(request.method) || isProbeBypass(request)) {
      return;
    }

    const scope = getScope();
    // §1: sin identidad autenticada no hay clave de hash posible.
    if (scope === undefined || scope.actor.kind !== 'user') {
      return;
    }

    const rawKey = readHeader(request, HEADERS.idempotencyKey);
    // §1: sin header, la request se procesa sin protección de idempotencia.
    if (rawKey === undefined || rawKey.trim() === '') {
      return;
    }

    const key = computeIdempotencyKey({
      userId: scope.actor.id,
      method: request.method,
      // La ruta **enrutada** (patrón), sin query string (contrato §3).
      path: request.routeOptions.url ?? request.url.split('?')[0] ?? request.url,
      key: rawKey,
    });
    const fingerprint = computeFingerprint(request.body);

    // §6: la segunda request con la misma clave en vuelo no se ejecuta.
    if (inFlight.has(key)) {
      throw new HttpError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'Otra request con la misma Idempotency-Key está en vuelo.',
        409,
      );
    }

    let stored: IdempotencyRecord | null = null;
    try {
      stored = await options.store.find(key);
    } catch (error: unknown) {
      // §8: un fallo de lectura se trata como miss; no se bloquea la mutación.
      reportFailure(error, 'read');
    }

    if (stored !== null) {
      if (stored.fingerprint !== fingerprint) {
        // §7: nunca se devuelve la respuesta de un payload distinto.
        throw new HttpError(
          ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'La Idempotency-Key se reusó con un payload distinto.',
          409,
        );
      }
      await reply.code(stored.statusCode).send(stored.body);
      return;
    }

    inFlight.add(key);
    pending.set(request, { key, fingerprint });
  });

  app.addHook('onSend', async (request, reply, payload: unknown) => {
    // Un hook `onSend` que bloquea el hilo (p. ej. PGlite sobre WASM) puede hacer
    // que Fastify lo invoque **dos veces** para la misma request; la segunda
    // llega con `payload` vacío. Se conserva el payload ya resuelto para no
    // vaciar el cuerpo de la respuesta.
    const body =
      payload === undefined && resolvedPayloads.has(request)
        ? resolvedPayloads.get(request)
        : payload;

    const execution = pending.get(request);
    if (execution === undefined) {
      return body;
    }

    pending.delete(request);
    inFlight.delete(execution.key);
    resolvedPayloads.set(request, body);

    // Solo se almacena una mutación **aplicada** (2xx): un 4xx/5xx no es un
    // resultado durable y no debe reemplazar la ejecución del reintento.
    if (reply.statusCode < 200 || reply.statusCode >= 300) {
      return body;
    }

    const now = options.clock.now();
    try {
      await options.store.save({
        key: execution.key,
        fingerprint: execution.fingerprint,
        statusCode: reply.statusCode,
        body: parsePayload(body),
        createdAt: now,
        expiresAt: idempotencyExpiry(now),
      });
    } catch (error: unknown) {
      // §8: la mutación ya se aplicó; el fallo de guardado no cambia la respuesta.
      reportFailure(error, 'write');
    }

    return body;
  });

  app.addHook('onResponse', async (request) => {
    // Cierra el estado en vuelo aunque `onSend` no haya llegado a correr.
    const execution = pending.get(request);
    if (execution === undefined) {
      return;
    }
    pending.delete(request);
    inFlight.delete(execution.key);
  });
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isProbeBypass(request: FastifyRequest): boolean {
  // ADR 0001 punto 6: el bypass solo se honra en endpoints de probe.
  const config = request.routeOptions.config as { connectivityProbe?: boolean } | undefined;
  if (config?.connectivityProbe !== true) {
    return false;
  }
  return isConnectivityProbe(readHeader(request, HEADERS.connectivityProbe));
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return payload;
    }
  }
  if (payload instanceof Uint8Array) {
    const text = Buffer.from(payload).toString('utf8');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return payload;
}