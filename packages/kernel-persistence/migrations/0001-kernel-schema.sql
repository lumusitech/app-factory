-- Esquema del kernel (dueño: `kernel-persistence`; evolución forward-only, D13).
--
-- Único arranque inicial del dueño (`evolution.md` §4: sin `*Init` acumulado).
-- Los cambios posteriores son migraciones incrementales, nunca nuevos `*Init`.

-- Outbox (D9/D10): el evento se escribe en la MISMA transacción que el agregado.
CREATE TABLE outbox (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  type         text        NOT NULL,
  aggregate_id text        NOT NULL,
  occurred_at  timestamptz NOT NULL,
  payload      jsonb       NOT NULL,
  published_at timestamptz
);

CREATE INDEX outbox_tenant_occurred_idx ON outbox (tenant_id, occurred_at);

-- Store de idempotencia (contrato de idempotencia §4/§5).
-- La clave `key` es el hash SHA-256(userId|method|path|key) (§3): NO incluye el
-- tenant (limitación explícita de ADR 0001). `tenant_id` es la columna de
-- scoping que exige D12 — no forma parte de la composición de la clave.
CREATE TABLE idempotency_record (
  tenant_id   text        NOT NULL,
  key         text        NOT NULL,
  fingerprint text        NOT NULL,
  status_code integer     NOT NULL,
  body        jsonb,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX idempotency_expires_idx ON idempotency_record (expires_at);

-- Backstop de aislamiento (D12): RLS por tenant. La sesión fija `app.tenant_id`
-- (SET LOCAL / set_config) desde el `ScopeContext` en la misma transacción; si
-- no está fijado, `current_setting(..., true)` es NULL y NO se ve ninguna fila
-- (fail-closed también en la base).
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_record ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbox_tenant_isolation ON outbox
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY idempotency_tenant_isolation ON idempotency_record
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));