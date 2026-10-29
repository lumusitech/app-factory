import { describe, expect, it } from 'vitest';

import { rowToSnapshot as assignmentToSnapshot } from '../../src/persistence/assignment-row.js';
import { headerParams, rowToSnapshot as attendanceToSnapshot } from '../../src/persistence/class-attendance-row.js';
import { rowToSnapshot as classTopicToSnapshot } from '../../src/persistence/class-topic-row.js';
import { rowToSnapshot as topicToSnapshot } from '../../src/persistence/topic-row.js';
import { Assignment } from '../../src/domain/assignment.js';
import { ClassAttendance } from '../../src/domain/class-attendance.js';
import { ClassTopic } from '../../src/domain/class-topic.js';
import { Topic } from '../../src/domain/topic.js';

describe('mappers de captura de clase (D7: entidad de persistencia + mapper explícito)', () => {
  it('topic: fila ↔ snapshot, y vuelta por `hydrate`', () => {
    const snapshot = topicToSnapshot({
      id: 'tema-1',
      tenant_id: 'docente-1',
      course_id: 'curso-3-1',
      order_index: 2,
      content: 'Tema',
      version: 1,
    });

    expect(snapshot).toEqual({
      id: 'tema-1',
      tenantId: 'docente-1',
      courseId: 'curso-3-1',
      order: 2,
      content: 'Tema',
      version: 1,
    });
    expect(Topic.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('class_topic: fila ↔ snapshot, y vuelta por `hydrate`', () => {
    const snapshot = classTopicToSnapshot({
      class_session_id: 'sesion-1',
      tenant_id: 'docente-1',
      topic_id: 'tema-1',
      version: 1,
    });

    expect(snapshot).toEqual({
      classSessionId: 'sesion-1',
      tenantId: 'docente-1',
      topicId: 'tema-1',
      version: 1,
    });
    expect(ClassTopic.hydrate(snapshot).snapshot()).toEqual(snapshot);
  });

  it('assignment: fila ↔ snapshot (con y sin `topic_id`), y vuelta por `hydrate`', () => {
    const withTopic = assignmentToSnapshot({
      id: 'tarea-1',
      tenant_id: 'docente-1',
      class_session_id: 'sesion-1',
      topic_id: 'tema-1',
      content: 'Consigna',
      version: 1,
    });
    expect(withTopic.topicId).toBe('tema-1');
    expect(Assignment.hydrate(withTopic).snapshot()).toEqual(withTopic);

    const withoutTopic = assignmentToSnapshot({
      id: 'tarea-2',
      tenant_id: 'docente-1',
      class_session_id: 'sesion-1',
      topic_id: null,
      content: 'Consigna',
      version: 1,
    });
    expect(withoutTopic.topicId).toBeNull();
  });

  it('attendance: cabecera + entradas ↔ snapshot, y vuelta por `hydrate`', () => {
    const snapshot = attendanceToSnapshot(
      { class_session_id: 'sesion-1', tenant_id: 'docente-1', version: 2 },
      [
        { student_id: 'legajo-1', status: 'presente' },
        { student_id: 'legajo-2', status: 'ausente' },
      ],
    );

    expect(snapshot).toEqual({
      classSessionId: 'sesion-1',
      tenantId: 'docente-1',
      entries: [
        { studentId: 'legajo-1', status: 'presente' },
        { studentId: 'legajo-2', status: 'ausente' },
      ],
      version: 2,
    });
    expect(ClassAttendance.hydrate(snapshot).snapshot()).toEqual(snapshot);
    expect(headerParams(snapshot)).toEqual(['sesion-1', 'docente-1', 2]);
  });
});
