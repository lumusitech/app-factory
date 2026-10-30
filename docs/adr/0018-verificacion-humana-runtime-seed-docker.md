# 0018 — Verificación humana del backend: runtime de desarrollo, seed idempotente y Docker

- **Estado:** propuesto
- **Fecha:** 2026-10-30
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D4, D9, D10, D16, D19, D22),
  §6, §7 (fase 5), §11.3 (despliegue); `docs/teacher-service-context.md` §2
  (T22, T24, T25), §4 (F-01 … F-05, F-12); `CONTRIBUTING.md` §3 (flujo) y §8
  (TDD; §8.3 nivel E2E); `docs/contracts/scope.md` §4, `docs/contracts/sync.md`
  §8, `docs/contracts/evolution.md` §3;
  [ADR 0008](0008-materializacion-kernel-client-y-conformance.md) §2,
  [ADR 0014](0014-planilla-oficial-f-04.md);
  `apps/teacher-service/README.md` §"Qué NO trae";
  PR del ADR 0018.

## Contexto

La **fase 5** (§7) ya entregó F-01 … F-05 y F-12 parcial sobre el kernel
(ADR 0011 … 0017). El avance se verifica **hoy solo con tests**: no hay UI
(diferida por ODD #1 y ADR 0008 §2) **ni tampoco** un servidor arrancable. Esto
tiene dos consecuencias concretas:

- No se puede verificar el backend **como humano** (curl, Postman, navegador) ni
  mostrar una **demo** —ni siquiera de APIs— sin escribir un harness efímero.
- A medida que se apilan features, crece el riesgo de acumular cambios
  verificados **únicamente** por la suite de Vitest.

Los hechos que enmarcan la decisión ya están escritos y no se re-litigan:

- **El composition root existe y está cableado.** `apps/teacher-service/src/app.ts`
  → `buildApp(deps)` devuelve un `FastifyInstance` con todas las rutas
  registradas (probe, alcance, idempotencia, envelope). **Nadie lo levanta**: no
  hay `main.ts` ni scripts `dev`/`start`, y no existe ningún `app.listen(...)` en
  el repo.
- **El driver de Postgres real ya existe.** `createPgConnection(pool)`
  (`packages/kernel-persistence/src/executor.ts:99`) está exportado y `pg@^8` ya
  es dependencia de `@kernel/persistence`. No hay que escribir driver.
- **Las migraciones ya existen.** `runAppMigrations(connection)`
  (`apps/teacher-service/src/migrations.ts`) aplica, forward-only, las del kernel
  y las propias. "Hacer las migraciones" = invocarla al boot.
- **Los tests ya son e2e de borde HTTP.** `app.inject(...)` recorre el ciclo
  completo de Fastify (routing → Zod → envelope → errores → alcance →
  idempotencia) contra Postgres real (PGlite WASM en memoria) con las migraciones
  reales (`apps/teacher-service/test/app.test.ts`, `test/http/*`). Los tests de
  `test/sync/*` corren el **cliente offline real** contra el servidor en proceso
  (`test/sync/support/harness.ts`, `InjectTransport`). No hay, todavía, el nivel
  **E2E** de `CONTRIBUTING.md` §8.3 (offline → reconexión → convergencia con
  Playwright "o equivalente").
- **La identidad es un placeholder.** `apps/teacher-service/src/identity.ts` →
  `headerSessionResolver` lee el header `x-tenant`. La autenticación real (login
  Google, T22) y el token público (T9) siguen pendientes: cualquier runtime de
  este corte **no es producción**.
- **La idempotencia es opcional.** `packages/kernel-http/src/idempotency/interceptor.ts`
  §1: solo se activa con `Idempotency-Key` + usuario autenticado.
- **OpenAPI sin UI.** `@fastify/swagger` publica el documento en
  `/documentation/json` y `/documentation/yaml`; **no** hay `@fastify/swagger-ui`.
- **Persistencia transaccional (D9/D10).** Los repositorios Pg escriben el
  predicado de tenant **y** el outbox en la **misma transacción**. Un seed con
  SQL crudo que no toque el outbox lo **desincroniza**.
- **No hay Docker** ni compose. El CI (`.github/workflows/ci.yml`) corre
  fronteras + typecheck + tests + build.

Queda por decidir **cómo se verifica el backend como humano** sin adelantar UI:
un runtime de desarrollo reproducible, con datos de demo, que permita probar los
endpoints existentes (y más adelante mostrar una demo del backend).

**Endpoints ya disponibles** (para curl/Postman una vez levantado el runtime):
`GET /probe` y `GET /documentation/json` (sin tenant); y bajo el header
`x-tenant`: `POST/GET/PATCH /class-sessions*`, `POST /courses/:courseId/topics`,
`PUT /class-sessions/:id/topic|attendance`, `POST
/class-sessions/:id/assignments`, `POST/GET /courses/:courseId/evaluations`,
`PUT/GET /evaluations/:id/grades`, `PUT/GET
/courses/:courseId/trajectory-assessments/:period`, `GET
/courses/:courseId/official-sheet.pdf`, `POST/GET /students/:studentId/records`,
`PUT/GET /courses/:courseId/period-closings/:period`, `GET
/courses/:courseId/worksheet.pdf` y `GET
/courses/:courseId/students/:studentId/worksheet.pdf`.

## Decisión

Se adopta, **de forma diferida** (aparcado a pedido del equipo; este ADR lo deja
planificado para retomarlo en un chat nuevo), un **runtime de desarrollo** que
levante el backend ya existente, aplique migraciones, cargue datos de demo de
forma **idempotente** y permita probar los endpoints con Postman/curl, más
**Docker** como paso posterior para "correr como producción". El runtime **no es
producción**: usa el `SessionResolver` placeholder (`x-tenant`) mientras T22 no
exista, y se marca como tal.

Se decide por pasos (cada uno, un PR chico, CONTRIBUTING §3):

1. **PR 1 — Entrypoint de runtime + scripts.** `apps/teacher-service/src/main.ts`:
   `env → pg.Pool → createPgConnection → runAppMigrations → buildApp → listen`,
   **fail-closed** ante env faltante (`DATABASE_URL`, `PORT`). Scripts `dev`/
   `start`. Con esto quedan desbloqueados curl/Postman y `GET /documentation/json`.
2. **PR 2 — Seed idempotente.** Script `seed` que carga datos de demo en un tenant
   dedicado. **Debe escribir por repositorios/dominio o por la API HTTP con
   `Idempotency-Key`, nunca por SQL crudo** (D9/D10: outbox en la misma
   transacción). Correrlo N veces no debe duplicar filas ni romper el outbox.
3. **PR 3 — Docker.** `Dockerfile` multi-stage (node 24 + pnpm workspaces) +
   compose (app + `postgres:17`); migraciones al arrancar; seed por comando
   aparte; healthcheck contra `/probe`.
4. **(Posterior, separado) E2E real.** El flujo offline → reconexión →
   convergencia de §8.3 (Playwright "o equivalente"). El runtime + seed lo
   habilita pero **no** lo reemplaza.

Sugerencia de agrupación: **PR 1 y 2 juntos**; **Docker como PR aparte**.

## Preguntas abiertas

1. **Base del dev server:** Postgres vía Docker/Compose (realista y objetivo final)
   vs **PGlite con directorio persistente** (cero infraestructura, ya en el repo)
   vs ambos. *Verificar* el soporte de data-dir en Node de la versión de PGlite
   usada.
2. **Mecanismo del seed:** por **API HTTP con `Idempotency-Key`** (más fiel:
   ejercita validación, alcance, outbox e idempotencia reales) vs por
   **repositorios/dominio en proceso** (más directo de depurar) vs SQL crudo
   (**descartado**: desincroniza el outbox y saltea invariantes).
3. **Docker en CI:** ¿job de build de imagen o solo local?
4. **Documentación de §11.3.** Hoy solo dice "un despliegue por producto"; falta
   nombrar **cómo corre el backend** en local/desarrollo.

## Consecuencias

- **Se gana** una forma **humana** de verificar el backend (curl/Postman) y la
  posibilidad de mostrar una **demo de APIs** sin UI, cortando el riesgo de
  "feature tras feature sin verificación humana".
- **Se gana** reutilizar lo que ya existe (`buildApp`, `createPgConnection`,
  `runAppMigrations`): el entrypoint es chico (~50 líneas) y no toca `packages/*`.
- **Se gana** el **nivel E2E** de `CONTRIBUTING.md` §8.3 como habilitado por el
  runtime (aunque se implemente en un paso posterior).
- **Se paga** infraestructura y ceremonia nuevas (env, scripts, seed, imagen
  Docker) que hoy no tienen consumidor de **producto**; el consumidor es el
  **desarrollador**. Es el costo explícito de poder verificar como humano.
- **Se paga** que el seed depende del modelo de la vertical y de F-06/F-15 para
  datos "realistas" completos (`Curso`/`Alumno`/`Calendario` aún opacos).
- **Fuera de alcance:** UI/`kernel-ui` (T24); autenticación real (T22) y token
  público (T9); el nivel E2E en sí (paso 4, separado); cualquier cambio al modelo
  de datos de §3.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| **Seguir solo con tests** (sin runtime) | Deja sin verificación humana ni demo de APIs; el riesgo crece con cada feature |
| **Harness efímero en `/tmp`** | No es reproducible ni reanudable; se reescribe cada vez y no queda documentado |
| **Levantar el servidor desde un test** (`app.listen` dentro de un `it`) | Mezcla verificación manual con la suite; no es un entrypoint de runtime real |
| **Seed con SQL crudo** | Desincroniza el outbox (D9/D10) y saltea las invariantes del dominio |
| **Docker primero** | Es el paso de mayor esfuerzo y menor retorno inmediato si el objetivo es probar endpoints; se difiere a PR 3 |
| **Runtime "de producción" ahora** | La identidad es placeholder (T22 pendiente): sería producción ficticia. Se nombra runtime/dev y se marca |
| **PGlite como único target** | No es el objetivo de despliegue (§11.3, Postgres real); sirve como atajo local, a decidir en las preguntas abiertas |
