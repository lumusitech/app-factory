import type { QueuedRequest } from '@kernel/contracts';

import type { QueueStore } from '../ports/queue-store.js';

/**
 * Adaptador de referencia **en memoria** del `QueueStore`. Sirve a los tests y a
 * la suite de convergencia; un navegador usaría IndexedDB y una app Android su
 * propio almacenamiento (sync §11).
 */
export class InMemoryQueueStore implements QueueStore {
  readonly #items = new Map<string, QueuedRequest>();

  async list(): Promise<readonly QueuedRequest[]> {
    return [...this.#items.values()].sort((a, b) => a.order - b.order);
  }

  async add(item: QueuedRequest): Promise<void> {
    if (this.#items.has(item.id)) {
      throw new Error(`El item ${item.id} ya existe en la cola.`);
    }
    this.#items.set(item.id, item);
  }

  async update(item: QueuedRequest): Promise<void> {
    if (!this.#items.has(item.id)) {
      throw new Error(`El item ${item.id} no existe en la cola.`);
    }
    this.#items.set(item.id, item);
  }

  async remove(id: string): Promise<void> {
    this.#items.delete(id);
  }
}
