-- Esquema de teacher-service (dueño: `teacher-service`; forward-only, D13).
--
-- Migración incremental 0003: calificaciones numéricas offline (F-02). Agrega
-- evaluación de un curso y la hoja de notas por evaluación. El diseño y las
-- decisiones de modelo están en `docs/adr/0012-calificaciones-f-02.md`.
--
-- El `course_id` y el `student_id` (legajo) son referencias opacas: las tablas
-- `course`/`student` todavía no existen (ADR 0010/0011). El `student_id` es un
-- identificador estable, nunca la posición en la lista (§7.4). El `period` es un
-- texto opaco (referencia al calendario institucional, no modelado; ADR 0012).

-- Evaluación de un curso (`nombre`, `período`, `peso`). Solo creación en F-02.
-- La clave es (tenant_id, id): el `id` lo puede aportar el cliente (D8), así que
-- su unicidad es por tenant (un id de docente no colisiona con otro).
CREATE TABLE evaluation (
  id                  text         NOT NULL,
  tenant_id           text         NOT NULL,
  course_id           text         NOT NULL,
  name                text         NOT NULL,
  period              text         NOT NULL,
  weight              numeric(12,4) NOT NULL,
  version             integer      NOT NULL,
  CONSTRAINT evaluation_pk PRIMARY KEY (tenant_id, id),
  CONSTRAINT evaluation_weight_check CHECK (weight > 0),
  CONSTRAINT evaluation_version_check CHECK (version >= 1)
);

CREATE INDEX evaluation_tenant_course_idx ON evaluation (tenant_id, course_id);

ALTER TABLE evaluation ENABLE ROW LEVEL SECURITY;

CREATE POLICY evaluation_tenant_isolation ON evaluation
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Cabecera de la hoja de notas de una evaluación (agregado por evaluación:
-- identidad + versión). Se captura y guarda atómica (§1.3: cargar 30 notas es un
-- acto). `evaluation_id` puede ser un id del cliente: la clave incluye el tenant.
CREATE TABLE grade_sheet (
  evaluation_id       text        NOT NULL,
  tenant_id           text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT grade_sheet_pk PRIMARY KEY (tenant_id, evaluation_id),
  CONSTRAINT grade_sheet_version_check CHECK (version >= 1)
);

CREATE INDEX grade_sheet_tenant_idx ON grade_sheet (tenant_id);

ALTER TABLE grade_sheet ENABLE ROW LEVEL SECURITY;

CREATE POLICY grade_sheet_tenant_isolation ON grade_sheet
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Filas de notas por (evaluación, alumno): la forma de §3.1. La escala es entera
-- 1–10 (T16); fuera de rango se rechaza en el dominio y acá se refuerza en la base.
CREATE TABLE grade_entry (
  evaluation_id       text        NOT NULL,
  tenant_id           text        NOT NULL,
  student_id          text        NOT NULL,
  value               integer     NOT NULL,
  CONSTRAINT grade_entry_pk PRIMARY KEY (tenant_id, evaluation_id, student_id),
  CONSTRAINT grade_value_check CHECK (value BETWEEN 1 AND 10)
);

CREATE INDEX grade_entry_tenant_idx ON grade_entry (tenant_id);

ALTER TABLE grade_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY grade_entry_tenant_isolation ON grade_entry
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
