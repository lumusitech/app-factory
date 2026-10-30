-- Esquema de teacher-service (dueño: `teacher-service`; forward-only, D13).
--
-- Migración incremental 0006: cierre de período (F-12 parcial). Agrega la hoja de
-- overrides manuales del cierre de un curso en un período (agregado batch) y sus
-- filas por alumno. El diseño y las decisiones de modelo están en
-- `docs/adr/0016-cierre-de-periodo-f-12.md`.
--
-- El `course_id` y el `student_id` (legajo) son referencias opacas: las tablas
-- `course`/`student` todavía no existen (ADR 0010). El `student_id` es un
-- identificador estable, nunca la posición en la lista (§7.4). El `period` es un
-- texto opaco (referencia al calendario institucional, no modelado; ADR 0012/0016):
-- no se hardcodea C1/C2 (§7.8). La nota **automática** no se persiste: es derivada
-- (T6/§7.1); acá solo vive el override manual.

-- Cabecera de la hoja de overrides del curso en un período (clave (curso, período)
-- + versión). Se captura y guarda atómica (§1.3: cerrar el curso es un acto).
CREATE TABLE period_closing (
  course_id           text        NOT NULL,
  period              text        NOT NULL,
  tenant_id           text        NOT NULL,
  version             integer     NOT NULL,
  CONSTRAINT period_closing_pk PRIMARY KEY (tenant_id, course_id, period),
  CONSTRAINT period_closing_version_check CHECK (version >= 1)
);

CREATE INDEX period_closing_tenant_idx ON period_closing (tenant_id);

ALTER TABLE period_closing ENABLE ROW LEVEL SECURITY;

CREATE POLICY period_closing_tenant_isolation ON period_closing
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Filas de overrides por (curso, período, alumno). La nota manual es la escala
-- entera 1–10 (T16); fuera de rango se rechaza en el dominio y acá se refuerza en
-- la base. El motivo es opcional.
CREATE TABLE period_closing_entry (
  course_id           text        NOT NULL,
  period              text        NOT NULL,
  tenant_id           text        NOT NULL,
  student_id          text        NOT NULL,
  value               integer     NOT NULL,
  motive              text,
  CONSTRAINT period_closing_entry_pk
    PRIMARY KEY (tenant_id, course_id, period, student_id),
  CONSTRAINT period_closing_entry_value_check CHECK (value BETWEEN 1 AND 10)
);

CREATE INDEX period_closing_entry_tenant_idx ON period_closing_entry (tenant_id);

ALTER TABLE period_closing_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY period_closing_entry_tenant_isolation ON period_closing_entry
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
