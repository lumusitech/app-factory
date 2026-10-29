import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { Topic } from '../domain/topic.js';
import type { TopicRepository } from '../domain/topic-repository.js';
import { rowToSnapshot, snapshotToParams } from './topic-row.js';
import type { TopicRow } from './topic-row.js';

/**
 * Adaptador de salida de `TopicRepository` (D7; ADR 0011).
 *
 * Aplica el **predicado de tenant** desde el `TransactionContext` (que sale del
 * `ScopeContext`; §4.1) y escribe el outbox en la **misma** transacción (D9/D10).
 */
export class PgTopicRepository implements TopicRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byId(id: string): Promise<Topic | null> {
    const { rows } = await this.context.executor.query<TopicRow>(
      `SELECT id, tenant_id, course_id, order_index, content, version
         FROM topic
        WHERE tenant_id = $1 AND id = $2`,
      [this.context.tenantId, id],
    );

    const row = rows[0];
    return row === undefined ? null : Topic.hydrate(rowToSnapshot(row));
  }

  async save(topic: Topic): Promise<void> {
    await this.context.executor.query(
      `INSERT INTO topic (id, tenant_id, course_id, order_index, content, version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, id) DO UPDATE SET course_id = EXCLUDED.course_id,
                                                 order_index = EXCLUDED.order_index,
                                                 content = EXCLUDED.content,
                                                 version = EXCLUDED.version`,
      snapshotToParams(topic.snapshot()),
    );

    await this.outbox.append(topic.pullEvents());
  }
}
