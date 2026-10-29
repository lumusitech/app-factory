-- Esquema de teacher-service (dueño: `teacher-service`; forward-only, D13).
--
-- Migración incremental 0004: valoración preliminar TEA/TEP/TED (F-03). Agrega la
-- hoja de valoraciones de un curso en un período (agregado batch) y sus filas por
-- alumno. El diseño y las decisiones de modelo están en
-- `docs/adr/0013-valoracion-preliminar-f-03.md`.
--
-- El `course_id` y el `student_id` (legajo) son referencias opacas: las tablas
-- `course`/`student` todavía no existen (ADR 0010/0011/0012). El `student_id` es
-- un identificador estable, nunca la posición en la lista (§7.4). El `period` es
-- un texto opaco (referencia al calendario institucional, no modelado; ADR 0013):
-- no se hardcodea C1/C2 (§7.8).

-- Cabecera de la hoja de valoraciones de un curso en un período (clave (curso,
-- período) + versión). Se captura y guarda atómica (§1.3: marcar el curso es un
-- acto).
CREATE TABLE trajectory_assessment (
  course_id           text        NOT NULL,
  period              text        NOT NULL,
  tenant_id           text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT trajectory_assessment_pk PRIMARY KEY (tenant_id, course_id, period),
  CONSTRAINT trajectory_assessment_version_check CHECK (version >= 1)
);

CREATE INDEX trajectory_assessment_tenant_idx ON trajectory_assessment (tenant_id);

ALTER TABLE trajectory_assessment ENABLE ROW LEVEL SECURITY;

CREATE POLICY trajectory_assessment_tenant_isolation ON trajectory_assessment
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Filas de valoraciones por (curso, período, alumno). El valor es el enum
-- TEA/TEP/TED (§3.4/§13.1); fuera del enum se rechaza en el dominio y acá se
-- refuerza en la base.
CREATE TABLE trajectory_assessment_entry (
  course_id           text        NOT NULL,
  period              text        NOT NULL,
  tenant_id           text        NOT NULL,
  student_id          text        NOT NULL,
  rating              text        NOT NULL,
  CONSTRAINT trajectory_assessment_entry_pk
    PRIMARY KEY (tenant_id, course_id, period, student_id),
  CONSTRAINT trajectory_rating_check CHECK (rating IN ('TEA', 'TEP', 'TED'))
);

CREATE INDEX trajectory_assessment_entry_tenant_idx ON trajectory_assessment_entry (tenant_id);

ALTER TABLE trajectory_assessment_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY trajectory_assessment_entry_tenant_isolation ON trajectory_assessment_entry
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
