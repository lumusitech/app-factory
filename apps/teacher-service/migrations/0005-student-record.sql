-- Esquema de teacher-service (dueño: `teacher-service`; forward-only, D13).
--
-- Migración incremental 0005: registro del alumno (F-05). Agrega el log
-- append-only de observaciones, movimientos y evolución por trabajo. El diseño y
-- las decisiones de modelo están en `docs/adr/0015-trayectoria-del-alumno.md`.
--
-- El `student_id` (legajo) y el `evaluation_id` son referencias opacas: las tablas
-- `student`/`course` todavía no existen (ADR 0010). El `student_id` es un
-- identificador estable, nunca la posición en la lista (§7.4). Cada fila es un
-- hecho **inmutable** con fecha; corregir es agregar otra fila.

CREATE TABLE student_record (
  id                  text        NOT NULL,
  tenant_id           text        NOT NULL,
  student_id          text        NOT NULL,
  kind                text        NOT NULL,
  occurred_on         date        NOT NULL,
  note                text,
  category            text,
  evaluation_id       text,
  grade               integer,
  version             integer     NOT NULL,
  CONSTRAINT student_record_pk PRIMARY KEY (tenant_id, id),
  CONSTRAINT student_record_kind_check
    CHECK (kind IN ('observacion', 'movimiento', 'evaluacion')),
  CONSTRAINT student_record_grade_check CHECK (grade IS NULL OR (grade BETWEEN 1 AND 10)),
  CONSTRAINT student_record_version_check CHECK (version >= 1),
  CONSTRAINT student_record_observation_note_check
    CHECK (kind <> 'observacion' OR note IS NOT NULL),
  CONSTRAINT student_record_movement_note_check
    CHECK (kind <> 'movimiento' OR note IS NOT NULL),
  CONSTRAINT student_record_evaluation_ref_check
    CHECK (kind <> 'evaluacion' OR evaluation_id IS NOT NULL),
  CONSTRAINT student_record_kind_fields_check
    CHECK (kind = 'evaluacion' OR (evaluation_id IS NULL AND grade IS NULL))
);

CREATE INDEX student_record_tenant_student_idx ON student_record (tenant_id, student_id);

ALTER TABLE student_record ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_record_tenant_isolation ON student_record
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
