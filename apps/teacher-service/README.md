# teacher-service

Vertical del monorepo `app-factory`, generada por `tools/create-vertical` (fase 4
de [`docs/kernel-context.md`](../../docs/kernel-context.md) §7). Nace **cableada
al kernel** y luego gana dominio con tests primero (D22, T25).

Estado: **fase 5, F-01** — captura de clase completa (asistencia + tema del
día + tarea), **offline**, sobre el kernel: agregados con invariantes, persistencia
y alcance, rutas y captura offline con convergencia.

## Qué trae cableado

- **Composition root** (`src/app.ts`) sobre `@kernel/http` (`buildServer`):
  envelope, filtro de errores, **alcance** e **idempotencia**.
- **Dominio** (`src/domain/`): los agregados de F-01 —`ClassSession` (`Clase`),
  `Topic` (tema del plan), `ClassTopic` (tema dictado), `Assignment` (tarea) y
  `ClassAttendance` (asistencia por clase)— con invariantes, eventos por outbox y
  token de versión (ADR 0010/0011). Los **puertos por agregado** siguen D6.
- **Persistencia** (`src/persistence/`): entidades de fila + **mappers explícitos**
  (D7) y repositorios Pg (predicado de tenant + outbox en la misma transacción,
  D9/D10). Migraciones propias en `migrations/` (`0001-class-session.sql`,
  `0002-class-capture.sql`).
- **Rutas** (`src/http/`): `POST/GET/PATCH /class-sessions`, `POST
  /courses/:courseId/topics`, `PUT /class-sessions/:id/topic`, `PUT
  /class-sessions/:id/attendance` y `POST /class-sessions/:id/assignments`, bajo
  la política `lww` (sync §8.3, T10) con el header `X-Sync-Base-Version`.
- **Captura offline** (`src/sync/`): el composition root del cliente
  (`createClassSessionSync`) cablea `@kernel/client` con la **política offline**
  de la vertical (encolables las rutas de captura de clase) y su endpoint de
  probe; `ClassSessionSync` traduce crear/transicionar/tema/asistencia/tarea a
  items de la cola, poblando `Idempotency-Key` y el token `baseVersion`. El
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
  (`test/domain/`), mappers (`test/persistence/`), borde HTTP
  (`test/class-session-api.test.ts`, `test/http/class-capture-api.test.ts`) y
  **convergencia offline** (`test/sync/` y `test/sync/capture.test.ts`:
  aceptación §7 + tabla de conformidad de sync §10 con red, watchdog, `5xx`,
  `401`/`4xx`, FIFO, head-of-line, conflicto `lww` y replay idempotente) — bordes
  y rutas críticas, no solo el camino feliz (D22, T25).

## Qué NO trae (a propósito)

- **Sin UI**: `kernel-ui` (mobile-first, PWA, Tailwind v4) llega cuando exista la
  pantalla que la consuma — nada entra sin consumidor real (ODD #1). El cliente
  offline ya está cableado en `src/sync/`, pero el **adaptador IndexedDB** y la
  pantalla que lo usa se difieren (ADR 0008 §2); en tests los adaptadores son en
  memoria.
- **Sin `Curso` ni `Alumno`**: `ClassSession` referencia su curso con un
  `courseId` opaco y la asistencia referencia al alumno con un `studentId` opaco
  (legajo interno, T4) hasta que se modelen `Curso`/`Alumno` (F-06) (ADR
  0010/0011).

## Comandos

```bash
pnpm install
pnpm --filter @app/teacher-service typecheck
pnpm --filter @app/teacher-service test
```
