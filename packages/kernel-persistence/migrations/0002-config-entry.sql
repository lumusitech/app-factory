-- Configuración por tenant (kernel-config; D19, ADR 0007).
--
-- Migración **incremental** (D13): NO es un `*Init`; el arranque inicial del
-- dueño sigue siendo `0001-kernel-schema.sql`. El esquema del kernel tiene un
-- único dueño (`kernel-persistence`, ADR 0004 §1).

CREATE TABLE config_entry (
  tenant_id      text        NOT NULL,
  key            text        NOT NULL,
  value          jsonb       NOT NULL,
  schema_version integer     NOT NULL,
  updated_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

-- Backstop de aislamiento (D12), igual que outbox/idempotency_record: la sesión
-- fija `app.tenant_id` desde el `ScopeContext`; sin él no se ve ninguna fila.
ALTER TABLE config_entry ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_entry_tenant_isolation ON config_entry
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));