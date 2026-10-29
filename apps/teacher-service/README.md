# teacher-service

Vertical del monorepo `app-factory`, generada por `tools/create-vertical` (fase 4
de [`docs/kernel-context.md`](../../docs/kernel-context.md) §7). Nace **cableada
al kernel** y luego gana dominio con tests primero (D22, T25).

Estado: **fase 5, Slice A** — el corte de servidor de F-01: una entidad de
dominio (`ClassSession`), su persistencia y su alcance. La captura offline y la
convergencia son el Slice B.

## Qué trae cableado

- **Composition root** (`src/app.ts`) sobre `@kernel/http` (`buildServer`):
  envelope, filtro de errores, **alcance** e **idempotencia**.
- **Dominio** (`src/domain/class-session.ts`): el agregado `ClassSession`
  (`Clase` de §3.1/§3.4 de
  [`docs/teacher-service-context.md`](../../docs/teacher-service-context.md)),
  con invariantes, eventos por outbox y token de versión (ADR 0010). El **puerto
  por agregado** (`class-session-repository.ts`) sigue D6.
- **Persistencia** (`src/persistence/`): entidad de fila + **mapper explícito**
  (D7) y `PgClassSessionRepository` (predicado de tenant + outbox en la misma
  transacción, D9/D10).
- **Rutas** (`src/http/class-session-routes.ts`): `POST` / `GET` / `PATCH` bajo la
  política `lww` (sync §8.3, T10) con el header `X-Sync-Base-Version`.
- **Alcance** (`src/identity.ts`): un `SessionResolver` **placeholder**. La
  autenticación real (login de Google, T22) y el token público (T9) son contratos
  aparte; reemplazá el stub antes de producción.
- **Configuración por tenant** (`src/config/registry.ts`): el
  `ConfigSchemaRegistry` de la vertical, que arranca **vacío** y por lo tanto
  **fail-closed**. Registrá tus claves y esquemas ahí (`@kernel/config`, D19).
- **Persistencia y migraciones** (`src/migrations.ts`): aplica las migraciones del
  kernel y las **propias** (`migrations/`, hoy `0001-class-session.sql`). Sos el
  **único dueño** de tu esquema
  ([`docs/contracts/evolution.md`](../../docs/contracts/evolution.md) §3).
- **Tests**: smoke del cableado (`test/app.test.ts`), invariantes de dominio
  (`test/domain/`), mapper (`test/persistence/`) y borde HTTP
  (`test/class-session-api.test.ts`) — bordes y rutas críticas, no solo el camino
  feliz (D22, T25).

## Qué NO trae (a propósito)

- **Sin UI**: `kernel-ui` (mobile-first, PWA, Tailwind v4) y el cliente offline
  (`kernel-client`) se cablean cuando exista la pantalla que los consuma — nada
  entra sin consumidor real (ODD #1).
- **Sin captura offline ni convergencia**: es el Slice B de la fase 5.
- **Sin `Curso`**: `ClassSession` referencia su curso con un `courseId` opaco
  hasta que se modele (ADR 0010).

## Comandos

```bash
pnpm install
pnpm --filter @app/teacher-service typecheck
pnpm --filter @app/teacher-service test
```
