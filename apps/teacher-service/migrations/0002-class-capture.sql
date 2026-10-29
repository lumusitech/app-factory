-- Esquema de teacher-service (dueño: `teacher-service`; forward-only, D13).
--
-- Migración incremental 0002: captura de clase (F-01). Agrega tema del plan,
-- tema dictado (vínculo Clase↔Tema), tarea y asistencia por clase. El diseño y
-- las decisiones de modelo están en `docs/adr/0011-captura-de-clase-f-01.md`.
--
-- El `course_id` y el `student_id` (legajo) son referencias opacas: las tablas
-- `course`/`student` todavía no existen (ADR 0010/0011). El `student_id` es un
-- identificador estable, nunca la posición en la lista (§7.4).

-- Temas del plan de un curso. Sin fechas: el cronograma se deriva (§7.2/§7.3).
-- La clave es (tenant_id, id): el `id` lo puede aportar el cliente (D8), así que
-- su unicidad es por tenant (un id de docente no colisiona con otro).
CREATE TABLE topic (
  id                  text        NOT NULL,
  tenant_id           text        NOT NULL,
  course_id           text        NOT NULL,
  order_index         integer     NOT NULL,
  content             text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT topic_pk PRIMARY KEY (tenant_id, id),
  CONSTRAINT topic_order_check CHECK (order_index >= 1),
  CONSTRAINT topic_version_check CHECK (version >= 1)
);

CREATE INDEX topic_tenant_course_idx ON topic (tenant_id, course_id);

ALTER TABLE topic ENABLE ROW LEVEL SECURITY;

CREATE POLICY topic_tenant_isolation ON topic
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Tema dictado: vínculo Clase↔Tema, uno por clase. No guarda fechas.
CREATE TABLE class_topic (
  class_session_id    text        PRIMARY KEY,
  tenant_id           text        NOT NULL,
  topic_id            text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT class_topic_version_check CHECK (version >= 1)
);

CREATE INDEX class_topic_tenant_idx ON class_topic (tenant_id);

ALTER TABLE class_topic ENABLE ROW LEVEL SECURITY;

CREATE POLICY class_topic_tenant_isolation ON class_topic
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Tarea (consigna del día), varias por clase; `topic_id` opcional.
CREATE TABLE assignment (
  id                  text        PRIMARY KEY,
  tenant_id           text        NOT NULL,
  class_session_id    text        NOT NULL,
  topic_id            text,
  content             text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT assignment_version_check CHECK (version >= 1)
);

CREATE INDEX assignment_tenant_class_idx ON assignment (tenant_id, class_session_id);

ALTER TABLE assignment ENABLE ROW LEVEL SECURITY;

CREATE POLICY assignment_tenant_isolation ON assignment
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Cabecera de la asistencia de una clase (agregado por clase: identidad + versión).
CREATE TABLE class_attendance (
  class_session_id    text        PRIMARY KEY,
  tenant_id           text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT class_attendance_version_check CHECK (version >= 1)
);

CREATE INDEX class_attendance_tenant_idx ON class_attendance (tenant_id);

ALTER TABLE class_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY class_attendance_tenant_isolation ON class_attendance
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Filas de asistencia por (clase, alumno): la forma de §3.1.
CREATE TABLE attendance_entry (
  class_session_id    text        NOT NULL,
  tenant_id           text        NOT NULL,
  student_id          text        NOT NULL,
  status              text        NOT NULL,
  CONSTRAINT attendance_entry_pk PRIMARY KEY (class_session_id, student_id),
  CONSTRAINT attendance_status_check
    CHECK (status IN ('presente', 'ausente', 'tarde', 'justificada', 'retirado'))
);

CREATE INDEX attendance_entry_tenant_idx ON attendance_entry (tenant_id);

ALTER TABLE attendance_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_entry_tenant_isolation ON attendance_entry
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
