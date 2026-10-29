# teacher-service

Vertical del monorepo `app-factory`, generada por `tools/create-vertical` (fase 4
de [`docs/kernel-context.md`](../../docs/kernel-context.md) §7). Nace **cableada
al kernel** y luego gana dominio con tests primero (D22, T25).

Estado: **fase 5, F-01 + F-02 + F-03** — captura de clase completa (asistencia +
tema del día + tarea), **calificaciones numéricas** y **valoración preliminar
TEA/TEP/TED**, todas **offline**, sobre el kernel: agregados con invariantes,
persistencia y alcance, rutas y captura offline con convergencia.

## Qué trae cableado

- **Composition root** (`src/app.ts`) sobre `@kernel/http` (`buildServer`):
  envelope, filtro de errores, **alcance** e **idempotencia**.
- **Dominio** (`src/domain/`): los agregados de F-01/F-02/F-03 —`ClassSession`
  (`Clase`), `Topic` (tema del plan), `ClassTopic` (tema dictado), `Assignment`
  (tarea), `ClassAttendance` (asistencia por clase), `Evaluation` (evaluación),
  `GradeSheet` (notas por evaluación) y `TrajectoryAssessment` (valoración
  preliminar TEA/TEP/TED por curso y período)— con invariantes, eventos por outbox
  y token de versión (ADR 0010/0011/0012/0013). Los **puertos por agregado** siguen
  D6.
- **Persistencia** (`src/persistence/`): entidades de fila + **mappers explícitos**
  (D7) y repositorios Pg (predicado de tenant + outbox en la misma transacción,
  D9/D10). Migraciones propias en `migrations/` (`0001-class-session.sql`,
  `0002-class-capture.sql`, `0003-evaluation-grades.sql`,
  `0004-trajectory-assessment.sql`).
- **Rutas** (`src/http/`): `POST/GET/PATCH /class-sessions`, `POST
  /courses/:courseId/topics`, `PUT /class-sessions/:id/topic`, `PUT
  /class-sessions/:id/attendance`, `POST /class-sessions/:id/assignments`,
  `POST/GET /courses/:courseId/evaluations`, `PUT/GET /evaluations/:id/grades` y
  `PUT/GET /courses/:courseId/trajectory-assessments/:period`, bajo la política
  `lww` (sync §8.3, T10) con el header `X-Sync-Base-Version`.
- **Captura offline** (`src/sync/`): el composition root del cliente
  (`createClassSessionSync`) cablea `@kernel/client` con la **política offline**
  de la vertical (encolables las rutas de captura de clase, de calificaciones y de
  valoración) y su endpoint de probe; `ClassSessionSync` traduce crear/transicionar/
  tema/asistencia/tarea/evaluación/notas/valoración a items de la cola, poblando
  `Idempotency-Key` y el token `baseVersion`. El cliente es **parametrizado por
  puertos** y sin navegador (D4, ADR 0008).
- **Alcance** (`src/identity.ts`): un `SessionResolver` **placeholder**. La
  autenticación real (login de Google, T22) y el token público (T9) son contratos
  aparte; reemplazá el stub antes de producción.
- **Configuración por tenant** (`src/config/registry.ts`): el
  `ConfigSchemaRegistry` de la vertical, que arranca **vacío** y por lo tanto
  **fail-closed**. Registrá tus claves y esquemas ahí (`@kernel/config`, D19).
- **Persistencia y migraciones** (`src/migrations.ts`): aplica las migraciones del
  kernel y las **propias** (`migrations/`). Sos el **único dueño** de tu esquema
  ([`docs/contracts/evolution.md`](../../docs/contracts/evolution.md) §3).
- **Tests**: smoke del cableado (`test/app.test.ts`), invariantes de dominio
  (`test/domain/`), mappers (`test/persistence/`), borde HTTP
  (`test/class-session-api.test.ts`, `test/http/`) y **convergencia offline**
  (`test/sync/`: aceptación §7 + tabla de conformidad de sync §10 con red,
  watchdog, `5xx`, `401`/`4xx`, FIFO, head-of-line, conflicto `lww`, replay
  idempotente, los bordes de rango de la escala 1–10 y los bordes del enum
  TEA/TEP/TED) — bordes y rutas críticas, no solo el camino feliz (D22, T25).

## Qué NO trae (a propósito)

- **Sin UI**: `kernel-ui` (mobile-first, PWA, Tailwind v4) llega cuando exista la
  pantalla que la consuma — nada entra sin consumidor real (ODD #1). El cliente
  offline ya está cableado en `src/sync/`, pero el **adaptador IndexedDB** y la
  pantalla que lo usa se difieren (ADR 0008 §2); en tests los adaptadores son en
  memoria.
- **Sin `Curso` ni `Alumno`**: `ClassSession` referencia su curso con un
  `courseId` opaco, la asistencia, las notas y la valoración referencian al alumno
  con un `studentId` opaco (legajo interno, T4), y la evaluación y la valoración
  referencian su curso con `courseId`, hasta que se modelen `Curso`/`Alumno` (F-06)
  (ADR 0010/0011/0012/0013). El `period` de la evaluación y de la valoración es un
  texto opaco (referencia al calendario institucional, F-15). La **valoración
  numérica final** no es una `Valoración`: es la `Nota` de `Evaluación` (F-02,
  ADR 0013). Los **umbrales por instancia** (§7.9/T16) y las **ventanas de
  mayo/octubre** (§7.8/T18) **no** se hardcodean: se difieren a `kernel-config`
  cuando una feature los consuma (F-04/F-10/F-12/F-15).

## Comandos

```bash
pnpm install
pnpm --filter @app/teacher-service typecheck
pnpm --filter @app/teacher-service test
```
