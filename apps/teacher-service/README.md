# teacher-service

Vertical del monorepo `app-factory`, generada por `tools/create-vertical` (fase 4
de [`docs/kernel-context.md`](../../docs/kernel-context.md) §7). Nace **cableada
al kernel** y luego gana dominio con tests primero (D22, T25).

Estado: **fase 5, Slice B** — sobre el corte de servidor de F-01 (entidad
`ClassSession`, persistencia y alcance), la **captura offline** con
`@kernel/client` y la **convergencia** end-to-end (crear → offline → sincronizar
→ converger → reintentar sin duplicar).

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
- **Captura offline** (`src/sync/`): el composition root del cliente
  (`createClassSessionSync`) cablea `@kernel/client` con la **política offline**
  de la vertical (encolables `POST /class-sessions` y `PATCH /class-sessions/:id`)
  y su endpoint de probe; `ClassSessionSync` traduce crear/transicionar a items
  de la cola, poblando `Idempotency-Key` y el token `baseVersion` (ADR 0010). El
  cliente es **parametrizado por puertos** y sin navegador (D4, ADR 0008).
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
  (`test/domain/`), mapper (`test/persistence/`), borde HTTP
  (`test/class-session-api.test.ts`) y **convergencia offline**
  (`test/sync/`: aceptación §7 + tabla de conformidad de sync §10 con red,
  watchdog, `5xx`, `401`/`4xx`, FIFO, head-of-line y conflicto `lww`) — bordes y
  rutas críticas, no solo el camino feliz (D22, T25).

## Qué NO trae (a propósito)

- **Sin UI**: `kernel-ui` (mobile-first, PWA, Tailwind v4) llega cuando exista la
  pantalla que la consuma — nada entra sin consumidor real (ODD #1). El cliente
  offline ya está cableado en `src/sync/`, pero el **adaptador IndexedDB** y la
  pantalla que lo usa se difieren (ADR 0008 §2); en tests los adaptadores son en
  memoria.
- **Sin `Curso`**: `ClassSession` referencia su curso con un `courseId` opaco
  hasta que se modele (ADR 0010).

## Comandos

```bash
pnpm install
pnpm --filter @app/teacher-service typecheck
pnpm --filter @app/teacher-service test
```
