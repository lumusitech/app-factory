import { describe, expect, it } from 'vitest';

import { InMemoryGetCacheStore } from './adapters/in-memory-get-cache-store.js';
import { CacheError } from './errors.js';
import { GET_CACHE_TTL_MS, GetCache } from './get-cache.js';
import type { TransportResult } from './ports/transport.js';
import {
  FixedClock,
  StubTransport,
  envelope,
  networkError,
  response,
} from '../test/support/fakes.js';

function makeCache(
  responder: (path: string) => TransportResult,
  options: { readonly maxEntries?: number } = {},
): { readonly cache: GetCache; readonly clock: FixedClock; readonly store: InMemoryGetCacheStore; readonly transport: StubTransport } {
  const clock = new FixedClock(new Date('2026-10-29T12:00:00.000Z'));
  const store = new InMemoryGetCacheStore();
  const transport = new StubTransport((request) => responder(request.path));
  const cache = new GetCache({
    clock,
    transport,
    store,
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  });
  return { cache, clock, store, transport };
}

describe('caché GET (§1.1)', () => {
  it('en miss hace el GET y guarda el body YA desenvuelto', async () => {
    const { cache, store } = makeCache(() => response(200, envelope({ items: [1, 2] })));

    const data = await cache.read<{ items: number[] }>('notes', '/notes');

    expect(data).toEqual({ items: [1, 2] });
    const entry = await store.get('notes');
    expect(entry?.data).toEqual({ items: [1, 2] });
    expect(entry).not.toHaveProperty('statusCode');
  });

  it('en hit válido devuelve la caché sin volver a pedir', async () => {
    const { cache, transport } = makeCache(() => response(200, envelope({ ok: true })));

    await cache.read('notes', '/notes');
    const again = await cache.read('notes', '/notes');

    expect(again).toEqual({ ok: true });
    expect(transport.requests).toHaveLength(1);
  });

  it('entrada vencida (TTL 7 días) se vuelve a pedir', async () => {
    const { cache, clock, transport } = makeCache(() => response(200, envelope({ ok: true })));

    await cache.read('notes', '/notes');
    clock.advance(GET_CACHE_TTL_MS);
    await cache.read('notes', '/notes');

    expect(transport.requests).toHaveLength(2);
  });

  it('LRU: al superar `maxEntries` desaloja la de acceso más antiguo', async () => {
    const { cache, clock, store } = makeCache(
      (path) => response(200, envelope({ path })),
      { maxEntries: 2 },
    );

    await cache.read('a', '/a');
    clock.advance(1000);
    await cache.read('b', '/b');
    clock.advance(1000);
    await cache.read('a', '/a'); // toca `a`, `b` queda como el más viejo
    clock.advance(1000);
    await cache.read('c', '/c');

    expect(await store.get('b')).toBeNull();
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('c')).not.toBeNull();
  });

  it('borde: sin red y sin caché válida lanza CacheError', async () => {
    const { cache } = makeCache(() => networkError(new Error('offline')));
    await expect(cache.read('notes', '/notes')).rejects.toBeInstanceOf(CacheError);
  });

  it('borde: un status no 2xx no se cachea y lanza', async () => {
    const { cache, store } = makeCache(() => response(500, envelope({ ok: false })));
    await expect(cache.read('notes', '/notes')).rejects.toBeInstanceOf(CacheError);
    expect(await store.get('notes')).toBeNull();
  });

  it('borde: un body sin forma de envelope lanza CacheError', async () => {
    const { cache } = makeCache(() => response(200, { notAnEnvelope: true }));
    await expect(cache.read('notes', '/notes')).rejects.toBeInstanceOf(CacheError);
  });
});
