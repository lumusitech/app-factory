# 0012 — Calificaciones numéricas offline (F-02): modelo de `Evaluación` y `Nota`

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D6, D7, D8, D9, D10, D11, D12,
  D13, D15, D19, D22, D23, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §1.3, §2 (T4, T6, T10, T16, T24, T25), §3.1, §3.4, §4 (F-02), §7.8, §7.9, §8;
  `docs/contracts/sync.md` §8, `docs/contracts/idempotency.md` §1,
  `docs/contracts/scope.md` §9, `docs/contracts/evolution.md` §3–§5;
  [ADR 0002](0002-decisiones-contrato-sync.md),
  [ADR 0008](0008-materializacion-kernel-client-y-conformance.md),
  [ADR 0010](0010-token-version-sync-teacher-service.md),
  [ADR 0011](0011-captura-de-clase-f-01.md);
  PR de F-02.

## Contexto

La fase 5 (§7) entrega `teacher-service` delgado con el criterio de salida
*"converge"*. El corte ya mergeado cubrió `Clase` (`ClassSession`, ADR 0010), su
captura offline con convergencia (Slice B) y F-01 completo (asistencia, tema del
día y tarea; ADR 0011). F-02 (`docs/teacher-service-context.md` §4) pide las
**calificaciones offline (numéricas)**.

§3.1 **ya nombra** las dos entidades: `Curso → Evaluación (nombre, período, peso)`
y `Evaluación → Nota (alumno, valor)`. §3.4 fija la valoración final **numérica
1–10**. [ADR 0011](0011-captura-de-clase-f-01.md) punto 1 difirió **explícitamente**
`Evaluación` y `Nota` a F-02. Al materializar F-02 aparecen puntos que ni §3 ni
las `D*`/`T*` cierran:

1. **Qué entidades entran.** ¿Solo la carga de `Nota` contra una `Evaluación`
   existente, o también la **creación** de `Evaluación`? Sin la segunda, F-02 no es
   autosuficiente offline (nada más crea `Evaluación`).
2. **Cómo referencian `Curso` y `Alumno`.** `courseId` es opaco (ADR 0010) y
   `studentId` es el **legajo interno** (T4), opaco hasta que se modele `Alumno`
   (F-06); §7.4 prohíbe identificar por posición en la lista.
3. **La forma de la `Nota`.** El ritual es *"cargar 30 notas"* (§1.3) sobre una
   evaluación: ¿una entidad por `(evaluación, alumno)` o un **batch por evaluación**?
4. **Límites y fuera de rango.** T16 fija la escala **entera 1–10**; hay que
   decidir dónde se valida el rango y qué pasa con un valor fuera de rango.
5. **El `peso` y el `período`.** §3.1 los lista: qué son y si la `Nota` lleva
   **fecha**.
6. **Los umbrales por instancia** (§7.9/T16). Regular = 7; intensificación = 4;
   configurables por escuela/curso. §7.8 prohíbe hardcodearlos y §7.9 prohíbe un
   umbral único: hay que decidir si entran como configuración (`kernel-config`,
   D19) o se difieren.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y `CONTRIBUTING.md` §6 ("si toqué el modelo de datos, paré y
propuse un ADR antes de escribir código"). **No duplica** lo que ya vive en §3.1/
§3.4 ni en D6–D13: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para F-02.

1. **Alcance: entran `Evaluation` y la hoja de notas por evaluación.** F-02 modela
   **`Evaluation` (Evaluación)** y un **agregado de notas por evaluación**
   (`GradeSheet`, ver punto 4). Entran **ambas** porque §3.1 las nombra y ADR 0011
   punto 1 las difirió a F-02, y porque **nada más crea `Evaluación`**: modelar solo
   la carga de `Nota` dejaría F-02 sin la entidad a la que la nota se ata y sin ser
   autosuficiente offline. `Curso`, `Alumno`, `Matrícula` y `Calendario` **no** se
   modelan todavía: se difieren a sus features (F-06, F-15). §4 v1 ("§3 completo")
   se satisface **incrementalmente feature por feature**, coherente con el corte
   delgado que ADR 0010 estableció.
2. **Referencias opacas.** `courseId` es opaco (ADR 0010) y `studentId` es el
   **legajo interno** (T4): un identificador **estable**, **nunca** la posición en
   la lista (§7.4). Sin clave foránea, porque las tablas `course`/`student` no
   existen todavía. Se documenta como limitación del corte, no como olvido.
3. **`Evaluation` (Evaluación)** — `{ id, tenantId, courseId, name, period,
   weight, version }`. `name` no vacío; `period` es un **texto opaco** (referencia
   al período del **calendario institucional**, que no se modela todavía: evita
   hardcodear `C1`/`C2`, §7.8); `weight` es un **número positivo** (el peso de la
   evaluación en el período; su uso —el promedio ponderado— es una **vista
   derivada**, T6, y pertenece a F-04/F-13, no a F-02). Es de **solo creación** en
   F-02 (como `Topic`): `POST /courses/:courseId/evaluations` la crea (`version` 1)
   y emite `evaluation.created`. **El `id` es opcional y lo puede aportar el
   cliente (UUIDv7, D8)**: es lo que permite crear la evaluación y cargar sus
   notas en la **misma** sesión offline, sin esperar al flush (el `GradeSheet`
   referencia un `evaluationId` que el cliente ya conoce); sin `id`, lo genera el
   servidor como en `ClassSession`.
4. **`GradeSheet` (notas) — agregado batch por evaluación.** El agregado es la
   hoja de notas de una evaluación: `{ evaluationId, tenantId, entries: [{ studentId,
   value }], version }`. Se persiste como **filas por (evaluación, alumno)** (la
   forma de §3.1), pero se captura y guarda **atómica** con `PUT
   /evaluations/:id/grades` (un item de cola por evaluación; §1.3: el ritual es un
   acto). Invariantes: `studentId` **único** dentro de la hoja, `value` **entero
   1–10** (T16), `version` ≥ 1. `PUT` reemplaza la hoja completa, con token
   `baseVersion` y política `lww`. La hoja **puede** tener cero entradas (curso sin
   alumnos, §8): es válida y limpia las notas de la evaluación.
5. **Valor entero 1–10 y fuera de rango.** El rango es un **invariante de dominio**
   (`1 ≤ value ≤ 10`, entero). Un valor fuera de rango o no entero es un error de
   validación del cliente: el borde responde **`400 VALIDATION_ERROR`** y, capturado
   offline, el item queda **`blocked`** (visible, nunca se descarta; sync §4). No hay
   redondeo ni recorte silencioso.
6. **La `Nota` no lleva fecha.** §3.1 la define `(alumno, valor)`: sin fecha. La
   trazabilidad la aporta el **`occurredAt` del evento de outbox** (`grades.recorded`,
   D9/D10), no un campo de negocio. Añadirla sería ampliar §3 sin consumidor.
7. **Umbrales por instancia: se difieren.** F-02 es **captura**: no introduce
   **ningún** umbral aprobatorio, ni global ni único. §7.8/§7.9/T16 prohíben
   hardcodearlos y asumir un mínimo único; cuando una feature los necesite (F-04
   boletín, F-10 intensificación), saldrán de **`kernel-config` (D19)** por escuela
   y/o curso, como configuración por tenant. Introducirlos ahora sería
   configuración **sin consumidor real** (ODD #1). F-02 **no crea** un mínimo
   global.
8. **Token y política de conflicto.** Se reusa ADR 0010 sin re-litigar: `version`
   entero **monótono** por entidad/hoja, expuesto como `String(version)` en el
   header **`X-Sync-Base-Version`** (ADR 0008 punto 5), política **`lww`** (T10,
   sync §8.3). Sin `baseVersion`, la operación no versiona y se aplica.
9. **Mecánica del agregado** (citas a decisiones ya cerradas): invariantes en el
   dominio (D6); **puerto por agregado**, nunca `Repository<T>`; **entidad de
   persistencia + mapper explícito** (D7); eventos en el **outbox** dentro de la
   **misma transacción** (`evaluation.created`, `grades.recorded`; D9/D10);
   **UUIDv7 generado en el dominio** (D8).
10. **Alcance (T1: el tenant es el docente).** Cada tabla lleva `tenant_id` y
    **RLS** (backstop, D12/scope §9); el repositorio aplica el **predicado de
    tenant** desde el `ScopeContext` vía `TransactionContext` —el puerto no recibe
    el alcance (§4.1, D11)—. Tenant **plano** (D25).
11. **Migración propia** de la vertical, `migrations/0003-evaluation-grades.sql`,
    incremental y forward-only (`evolution.md` §3–§5). El kernel **no** migra
    tablas de la vertical, ni al revés.
12. **Captura offline.** Se extiende la **política offline** y la fachada
    `ClassSessionSync` de la vertical (ADR 0011): encolables `POST
    /courses/:courseId/evaluations` y `PUT /evaluations/:id/grades`; el cliente
    sigue **parametrizado por puertos** y **sin navegador** (D4, ADR 0008). La
    convergencia se prueba en el arnés de la vertical
    (`apps/teacher-service/test/sync/`), **no** en `kernel-conformance` (frontera
    `kernel-does-not-import-apps`, D15).
13. **Sin cambio a §3 del documento de producto.** `Evaluación` y `Nota` ya están
    en §3.1 y la valoración numérica 1–10 en §3.4. A diferencia de ADR 0011 (que
    **amplió** §3 con `Tarea` y los estados de asistencia), acá no hay campo nuevo
    de producto: la forma batch es un artefacto de **captura/agregado**, no un
    cambio de modelo. Este ADR **no edita** `teacher-service-context.md` §3 (mismo
    criterio que ADR 0010 punto 9).

## Consecuencias

- **Se gana** F-02 completo: `Evaluación` y `Nota` capturables **offline** con la
  cola + idempotencia del kernel, convergiendo (fase 5) y **sin tocar `packages/*`**
  — la vertical solo extiende su `OfflinePolicy` y su fachada `ClassSessionSync`
  (D15, ADR 0008).
- **Se gana** la velocidad del ritual (§1.3): cargar las notas de una evaluación es
  **un** acto (un item de cola atómico), no N escrituras; y crear la evaluación +
  cargar sus notas cabe en **una** sesión offline gracias al `id` del cliente.
- **Se gana** un modelo que respeta las prohibiciones duras: el alumno por
  **legajo**, no por posición (§7.4); la escala **entera 1–10** (T16) como
  invariante; **ningún** umbral hardcodeado ni único (§7.8/§7.9); la planilla sigue
  siendo una **vista derivada** (T6).
- **Se gana** coherencia con ADR 0010/0011: mismo `version` entero, mismo header,
  misma política `lww`, mismo patrón de agregado batch (`ClassAttendance`).
- **Se paga** que `courseId`/`studentId` son referencias **colgantes** hasta que
  se modelen `Curso` (futuro) y `Alumno` (F-06).
- **Se paga** que el `id` opcional del cliente en `Evaluation` **diverge** de
  `ClassSession` (id server-side): se acepta por la misma razón que en `Topic`
  (crear + referenciar offline en una sesión; D8 lo permite).
- **Se paga** que `period` es un texto opaco, no un enum: es deliberado mientras el
  calendario institucional (T18/F-15) no sea un dato modelado; fijarlo ahora
  hardcodearía el calendario.
- **Fuera de alcance:** UI/`kernel-ui` (T24); el adaptador IndexedDB; `Curso`,
  `Alumno`, `Matrícula` y `Calendario`; el cálculo de la planilla/boletín y el
  promedio ponderado (F-04/F-13); los umbrales por instancia y su configuración
  (`kernel-config`, D19); la valoración preliminar TEA/TEP/TED (F-03); la
  intensificación (F-10); la edición/borrado de evaluaciones más allá de la
  captura.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Modelar **solo** la carga de `Nota` contra una `Evaluación` preexistente | Nada más crea `Evaluación` (ADR 0011 la difirió a F-02); F-02 no sería autosuficiente offline ni tendría dónde atar la nota |
| Modelar **todo §3** (Curso, Alumno, Matrícula, Calendario) en este PR | Contradice ODD #1 y el corte delgado de ADR 0010; mete features de otros `F-xx` en F-02 (`CONTRIBUTING` §7) |
| `Nota` como **fila por (evaluación, alumno)**, N items de cola | Rompe la velocidad del ritual (§1.3: cargar 30 notas es un acto) y multiplica los items; `lww` por fila no aporta |
| `Nota` como **batch sin agregado** | Pierde invariantes (alumno duplicado, valor fuera de rango) y un token de versión natural |
| `value` como **texto libre** o con **recorte** al rango | Sin invariante; T16 fija la escala entera 1–10 y el recorte silencioso oculta un error del cliente |
| `Nota` **con fecha** | §3.1 la define `(alumno, valor)`; la trazabilidad ya la da el `occurredAt` del outbox. Ampliaría §3 sin consumidor |
| `period` como **enum `C1`/`C2`** | Hardcodearía el calendario institucional, que es **configurable por escuela** (T18, §7.8); debe ser una referencia opaca hasta modelarlo (F-15) |
| `weight` **opcional** / con default | §3.1 lo lista como atributo de la evaluación; un default inventaría una política de cálculo que es vista derivada (T6) |
| Umbrales por instancia **en F-02** (global o en `kernel-config`) | Sin consumidor real en la captura (ODD #1); §7.8/§7.9 prohíben hardcodear o asumir un único mínimo. Se difieren al feature que los usa |
| Crear la `Evaluación` **solo server-side** (sin `id` del cliente) | Impide crear + calificar en la misma sesión offline; obliga a esperar el flush (mismo caso que `Topic`, ADR 0011) |
| Añadir `version` de escritura a `Evaluation` con mutación | No hay mutación de evaluación en F-02 (solo creación); su `version` queda en 1 como `Topic`, lista para una mutación futura con su propio ADR |
| Fijar el token/política en el kernel | Prohibido por ADR 0002 §4 y ADR 0008 punto 5 (pre-diseñaría el modelo de la vertical) |
