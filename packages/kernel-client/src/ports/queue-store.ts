import type { QueuedRequest } from '@kernel/contracts';

/**
 * Persistencia local de la cola offline (sync §11: el almacenamiento concreto es
 * un adaptador — IndexedDB u otro). El núcleo del cliente **no** conoce el motor:
 * solo este puerto. La implementación de referencia es en memoria.
 */
export interface QueueStore {
  /** Todos los items, ordenados por `order` ascendente (FIFO, sync §5.1). */
  list(): Promise<readonly QueuedRequest[]>;
  /** Agrega un item nuevo (no debe existir ya). */
  add(item: QueuedRequest): Promise<void>;
  /** Reemplaza un item existente (mismo `id`). */
  update(item: QueuedRequest): Promise<void>;
  /** Borra un item (transición terminal `remove`, sync §4). */
  remove(id: string): Promise<void>;
}
