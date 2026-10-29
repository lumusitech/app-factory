-- Esquema de teacher-service (dueño: `teacher-service`; forward-only, D13).
--
-- Primer arranque inicial del dueño; los cambios posteriores son migraciones
-- incrementales, nunca nuevos `*Init` (evolution.md §4). El kernel no migra estas
-- tablas, ni al revés (§3).

-- Clases del docente (T1: el tenant es el docente). La escuela es un atributo del
-- curso (T2), no un tenant; el `course_id` es una referencia opaca hasta que se
-- modele `Curso` (ADR 0010).
CREATE TABLE class_session (
  id                  text        PRIMARY KEY,
  tenant_id           text        NOT NULL,
  course_id           text        NOT NULL,
  date                date        NOT NULL,
  status              text        NOT NULL,
  cancellation_reason text,
  version             integer     NOT NULL,
  CONSTRAINT class_session_status_check
    CHECK (status IN ('dictada', 'cancelada', 'feriado', 'sin_clase')),
  CONSTRAINT class_session_version_check CHECK (version >= 1),
  CONSTRAINT class_session_reason_check
    CHECK ((status = 'cancelada') = (cancellation_reason IS NOT NULL))
);

CREATE INDEX class_session_tenant_idx ON class_session (tenant_id);

-- Backstop de aislamiento (D12): RLS por tenant, igual que el esquema del kernel.
-- La sesión fija `app.tenant_id` desde el `ScopeContext`; sin él no se ve ninguna
-- fila (fail-closed también en la base).
ALTER TABLE class_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY class_session_tenant_isolation ON class_session
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
