# teacher-service

Vertical del monorepo `app-factory`, generada por `tools/create-vertical` (fase 4
de [`docs/kernel-context.md`](../../docs/kernel-context.md) §7). Nace ya
**cableada al kernel**; el dominio y la UI se agregan después, con tests primero
(D22).

## Qué trae cableado

- **Composition root** (`src/app.ts`) sobre `@kernel/http` (`buildServer`):
  envelope, filtro de errores, **alcance** e **idempotencia**.
- **Alcance** (`src/identity.ts`): un `SessionResolver` **placeholder**. La
  autenticación real (login de Google, T22) y el token público (T9) son contratos
  aparte; reemplazá el stub antes de producción.
- **Configuración por tenant** (`src/config/registry.ts`): el
  `ConfigSchemaRegistry` de la vertical, que arranca **vacío** y por lo tanto
  **fail-closed**. Registrá tus claves y esquemas ahí (`@kernel/config`, D19).
- **Persistencia y migraciones** (`src/migrations.ts`): aplica las migraciones del
  kernel y las **propias** (`migrations/`). Sos el **único dueño** de tu esquema
  ([`docs/contracts/evolution.md`](../../docs/contracts/evolution.md) §3).
- **Tests** (`test/app.test.ts`): smoke del cableado (probe, alcance fail-closed,
  migraciones).

## Qué NO trae (a propósito)

- **Sin agregado de dominio**: los agregados y sus reglas son de la vertical
  ([`docs/contracts/not-extracted.md`](../../docs/contracts/not-extracted.md) §3).
- **Sin UI**: `kernel-ui` (mobile-first, PWA, Tailwind v4) y el cliente offline
  (`kernel-client`) se cablean cuando exista la pantalla que los consuma — nada
  entra sin consumidor real (ODD #1).

## Comandos

```bash
pnpm install
pnpm --filter @app/teacher-service typecheck
pnpm --filter @app/teacher-service test
```
