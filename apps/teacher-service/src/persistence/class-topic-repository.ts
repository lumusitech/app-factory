import type { OutboxPort } from '@kernel/domain';
import type { TransactionContext } from '@kernel/persistence';

import { ClassTopic } from '../domain/class-topic.js';
import type { ClassTopicRepository } from '../domain/class-topic-repository.js';
import { rowToSnapshot, snapshotToParams } from './class-topic-row.js';
import type { ClassTopicRow } from './class-topic-row.js';

/**
 * Adaptador de salida de `ClassTopicRepository` (D7; ADR 0011). Predicado de
 * tenant desde el `TransactionContext` y outbox en la **misma** transacción.
 */
export class PgClassTopicRepository implements ClassTopicRepository {
  constructor(
    private readonly context: TransactionContext,
    private readonly outbox: OutboxPort,
  ) {}

  async byClassSessionId(classSessionId: string): Promise<ClassTopic | null> {
    const { rows } = await this.context.executor.query<ClassTopicRow>(
      `SELECT class_session_id, tenant_id, topic_id, version
         FROM class_topic
        WHERE tenant_id = $1 AND class_session_id = $2`,
      [this.context.tenantId, classSessionId],
    );

    const row = rows[0];
    return row === undefined ? null : ClassTopic.hydrate(rowToSnapshot(row));
  }

  async save(classTopic: ClassTopic): Promise<void> {
    await this.context.executor.query(
      `INSERT INTO class_topic (class_session_id, tenant_id, topic_id, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_session_id) DO UPDATE SET topic_id = EXCLUDED.topic_id,
                                                    version = EXCLUDED.version`,
      snapshotToParams(classTopic.snapshot()),
    );

    await this.outbox.append(classTopic.pullEvents());
  }
}
