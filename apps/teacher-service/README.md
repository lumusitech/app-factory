# teacher-service

Vertical del monorepo `app-factory`, generada por `tools/create-vertical` (fase 4
de [`docs/kernel-context.md`](../../docs/kernel-context.md) §7). Nace **cableada
al kernel** y luego gana dominio con tests primero (D22, T25).

Estado: **fase 5, F-01 + F-02 + F-03 + F-04 + F-05** — captura de clase completa
(asistencia + tema del día + tarea), **calificaciones numéricas**, **valoración
preliminar TEA/TEP/TED**, la **planilla oficial PBA en PDF** (vista derivada,
plantilla como dato, render en servidor) y el **registro/trayectoria del alumno**
(observaciones, movimientos y evolución), todas **offline**, sobre el kernel:
agregados con invariantes, persistencia y alcance, rutas y captura offline con
convergencia.

## Qué trae cableado

- **Composition root** (`src/app.ts`) sobre `@kernel/http` (`buildServer`):
  envelope, filtro de errores, **alcance** e **idempotencia**.
- **Dominio** (`src/domain/`): los agregados de F-01/F-02/F-03 —`ClassSession`
  (`Clase`), `Topic` (tema del plan), `ClassTopic` (tema dictado), `Assignment`
  (tarea), `ClassAttendance` (asistencia por clase), `Evaluation` (evaluación),
  `GradeSheet` (notas por evaluación) y `TrajectoryAssessment` (valoración
  preliminar TEA/TEP/TED por curso y período)— con invariantes, eventos por outbox
  y token de versión (ADR 0010/0011/0012/0013). Los **puertos por agregado** siguen
  D6. F-04 suma la **vista derivada** de la planilla (`official-sheet.ts`): pura,
  sin persistencia, con el promedio ponderado y el roster por **legajo** (T6/§7.4,
  ADR 0014). F-05 suma `StudentRecord` (`student-record.ts`): el
  **registro/trayectoria del alumno**, un log **append-only** por legajo con
  entradas `observacion` · `movimiento` · `evaluacion` (ADR 0015).
- **Persistencia** (`src/persistence/`): entidades de fila + **mappers explícitos**
  (D7) y repositorios Pg (predicado de tenant + outbox en la misma transacción,
  D9/D10). F-04 suma el **read model** de la planilla
  (`official-sheet-read-model.ts`): lectura cross-agregado por `course_id` con el
  predicado de tenant (no es un agregado; ADR 0014). Migraciones propias en
  `migrations/` (`0001-class-session.sql`,
  `0002-class-capture.sql`, `0003-evaluation-grades.sql`,
  `0004-trajectory-assessment.sql`, `0005-student-record.sql`).
- **Rutas** (`src/http/`): `POST/GET/PATCH /class-sessions`, `POST
  /courses/:courseId/topics`, `PUT /class-sessions/:id/topic`, `PUT
  /class-sessions/:id/attendance`, `POST /class-sessions/:id/assignments`,
  `POST/GET /courses/:courseId/evaluations`, `PUT/GET /evaluations/:id/grades` y
  `PUT/GET /courses/:courseId/trajectory-assessments/:period`, bajo la política
  `lww` (sync §8.3, T10) con el header `X-Sync-Base-Version`. F-04 suma
  `GET /courses/:courseId/official-sheet.pdf`: la planilla derivada renderizada a
  **PDF** en el servidor (lectura binaria **fuera** del envelope; ADR 0014). F-05
  suma `POST/GET /students/:studentId/records`: agrega y lista las entradas del
  registro del alumno (ADR 0015).
- **Captura offline** (`src/sync/`): el composition root del cliente
  (`createClassSessionSync`) cablea `@kernel/client` con la **política offline**
  de la vertical (encolables las rutas de captura de clase, de calificaciones, de
  valoración y del registro) y su endpoint de probe; `ClassSessionSync` traduce
  crear/transicionar/tema/asistencia/tarea/evaluación/notas/valoración/registro a
  items de la cola, poblando `Idempotency-Key` y el token `baseVersion`. El cliente
  es **parametrizado por puertos** y sin navegador (D4, ADR 0008).
- **Alcance** (`src/identity.ts`): un `SessionResolver` **placeholder**. La
  autenticación real (login de Google, T22) y el token público (T9) son contratos
  aparte; reemplazá el stub antes de producción.
- **Configuración por tenant** (`src/config/registry.ts`): el
  `ConfigSchemaRegistry` de la vertical (`@kernel/config`, D19). F-04 registra la
  clave de la **plantilla de la planilla** (`document.template.pba-secondary-2026`,
  dato versionado por jurisdicción/nivel/año; T7, ADR 0014). Cualquier otra clave
  sigue **fail-closed** hasta registrarla.
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
  F-04 agrega la vista derivada (`test/domain/official-sheet.test.ts`), la
  plantilla fail-closed (`test/documents/template.test.ts`), el PDF determinista
  (`test/documents/pdf-renderer.test.ts`) y el borde de la planilla
  (`test/http/official-sheet-api.test.ts`: binario, curso vacío, cross-tenant,
  `SCOPE_MISSING`, cabecera opaca, override de plantilla y fail-closed). F-05
  agrega el registro del alumno (`test/domain/student-record.test.ts`, mappers) y
  su borde (`test/http/student-record-api.test.ts`, `test/sync/student-records.test.ts`:
  los tres tipos, límites 1–10, fecha, orden de la trayectoria, cross-tenant,
  `SCOPE_MISSING`, replay y convergencia offline).

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
  cuando una feature los consuma (F-10/F-12/F-15).
- **Sin persistir la planilla**: F-04 es una **vista derivada** —no una tabla
  editable (§7.1/T6)—: no agrega tablas ni migración. La **plantilla** es dato
  versionado (`kernel-config`) y el render es en **servidor** (el render
  local/offline se difiere, §8 ⚠️). **Excel/CSV**, el **enlace público** (T8/T9) y
  la promoción a `kernel-documents`/`kernel-storage` (D18) quedan fuera (ADR 0014).
- **Registro sí; planilla imprimible y cierre todavía no**: F-05 captura el
  **registro/trayectoria** (ADR 0015). La **planilla de uso diario imprimible**, el
  **cierre de período** (promedio automático + override manual) y la **búsqueda
  fuzzy** por nombre quedan para slices siguientes (la búsqueda necesita `Alumno`,
  F-06). La **dimensión/radar** (fortalezas/debilidades) y la **intensificación**
  (F-10/F-11) también quedan fuera.

## Comandos

```bash
pnpm install
pnpm --filter @app/teacher-service typecheck
pnpm --filter @app/teacher-service test
```
