# 0013 — Valoración preliminar TEA/TEP/TED offline (F-03): modelo de `TrajectoryAssessment`

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D6, D7, D8, D9, D10, D11, D12,
  D13, D15, D19, D22, D23, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §1.3, §2 (T4, T6, T10, T16, T17, T18, T24, T25), §3.1, §3.3, §3.4, §4 (F-03),
  §5, §6, §7.8, §8, §11, §13.1; `docs/contracts/sync.md` §8, `docs/contracts/idempotency.md` §1,
  `docs/contracts/scope.md` §9, `docs/contracts/evolution.md` §3–§5;
  [ADR 0002](0002-decisiones-contrato-sync.md),
  [ADR 0008](0008-materializacion-kernel-client-y-conformance.md),
  [ADR 0010](0010-token-version-sync-teacher-service.md),
  [ADR 0011](0011-captura-de-clase-f-01.md),
  [ADR 0012](0012-calificaciones-f-02.md);
  PR de F-03.

## Contexto

La fase 5 (§7) entrega `teacher-service` delgado con el criterio de salida
*"converge"*. El corte ya mergeado cubrió `Clase` (`ClassSession`, ADR 0010), su
captura offline con convergencia (Slice B), F-01 completo (asistencia, tema del
día y tarea; ADR 0011) y F-02 (calificaciones numéricas offline; ADR 0012). F-03
(`docs/teacher-service-context.md` §4) pide la **valoración preliminar
TEA/TEP/TED a mitad de cuatrimestre** (mayo y octubre; T17, §13.1).

§3.4 fija los valores: `TEA · TEP · TED (preliminar) · numérica 1–10 (final)`.
§13.1 los nombra: **TEA** = Trayectoria Educativa Avanzada, **TEP** = en Proceso,
**TED** = Discontinua (Res. 1236/23 DGCyE). §3.3 ubica la valoración preliminar en
la mitad de cada cuatrimestre (mayo, octubre) como **dato configurable** del
calendario institucional. §8 la lista como carga **offline** (cola) y §1.3 exige
que el ritual de marcar la valoración de un curso sea **rápido**.

§3.1 **ya nombra** la entidad: `Matrícula → Valoración (período, tipo: preliminar
TEA/TEP/TED | final numérica)`. Al materializar F-03 aparecen puntos que ni §3 ni
las `D*`/`T*` cierran:

1. **Qué entidad entra y cómo se reconcilia §3.1.** §3.1 dibuja **una** entidad
   `Valoración` con `tipo` *preliminar cualitativa* **o** *final numérica*,
   colgando de `Matrícula`. Pero [ADR 0012](0012-calificaciones-f-02.md) ya modeló
   la **numérica final** como `Evaluación → Nota` (colgando de `Curso`), sin tocar
   §3.1 (punto 13). Hay, por tanto, una **tensión pendiente** entre §3.1 y el
   código de F-02 que F-03 debe reconciliar.
2. **Cómo referencia `Curso` y `Alumno`.** `courseId` es opaco (ADR 0010) y
   `studentId` es el **legajo interno** (T4), opaco hasta que se modele `Alumno`
   (F-06). §3.1 cuelga la `Valoración` de `Matrícula`, que **tampoco** existe.
3. **El valor.** Si es el enum `TEA/TEP/TED` (§3.4) y **dónde** se valida.
4. **El `período` y la fecha.** §3.1 lista `(período, tipo)`: qué pesa el período
   y si la valoración lleva **fecha** de negocio.
5. **La forma de la captura.** El ritual (§1.3, §5: *"Calificaciones → carga
   rápida, valoraciones TEA/TEP/TED"*) es un **acto** por curso y período: ¿una
   entidad por `(curso, período, alumno)` o un **batch por `(curso, período)`**?
6. **Las ventanas de mayo/octubre.** T18 y §7.8 prohíben hardcodear fechas: hay
   que decidir si entran como configuración (`kernel-config`, D19) o se difieren.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y `CONTRIBUTING.md` §6 ("si toqué el modelo de datos, paré y
propuse un ADR antes de escribir código"). **No duplica** lo que ya vive en §3.1/
§3.4 ni en D6–D13: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para F-03.

1. **Alcance: entra la valoración preliminar cualitativa.** F-03 modela el
   agregado `TrajectoryAssessment` (**Valoración**) con el valor enum
   `TEA/TEP/TED`. La **valoración numérica final** **no** entra: ya está cubierta
   por `Evaluación`/`Nota` (F-02, [ADR 0012](0012-calificaciones-f-02.md)). `Curso`,
   `Alumno`, `Matrícula` y `Calendario` **no** se modelan todavía: se difieren a
   sus features (F-06, F-15). §4 v1 ("§3 completo") se satisface **incrementalmente
   feature por feature**, coherente con el corte delgado de ADR 0010.
2. **Referencias opacas.** `courseId` es opaco (ADR 0010) y `studentId` es el
   **legajo interno** (T4): un identificador **estable**, **nunca** la posición en
   la lista (§7.4). Sin clave foránea, porque las tablas `course`/`student` no
   existen todavía. Se documenta como limitación del corte, no como olvido.
3. **Valor: enum `TEA/TEP/TED`, validado en el dominio y reforzado en la base.**
   El valor es el enum de §3.4/§13.1. Un valor fuera del enum es un error de
   validación del cliente: el borde responde **`400 VALIDATION_ERROR`** y,
   capturado offline, el item queda **`blocked`** (visible, nunca se descarta;
   sync §4). No hay recorte ni valor por defecto. La base refuerza con
   `CHECK (rating IN ('TEA','TEP','TED'))` (mismo criterio que los estados de
   asistencia, [ADR 0011](0011-captura-de-clase-f-01.md) punto 7).
4. **`period` opaco y sin fecha de negocio.** `period` es un **texto opaco**
   (referencia al período del **calendario institucional**, que no se modela
   todavía: evita hardcodear `C1`/`C2`, §7.8/T18), como el de `Evaluation`
   ([ADR 0012](0012-calificaciones-f-02.md) punto 3). La valoración **no** lleva
   fecha: §3.1 la define `(período, tipo)`; la trazabilidad la aporta el
   **`occurredAt` del evento de outbox** (`trajectory-assessment.recorded`,
   D9/D10), no un campo de negocio — mismo criterio que `Nota` (ADR 0012 punto 6).
5. **`TrajectoryAssessment` (Valoración) — agregado batch por `(curso, período)`.**
   El agregado es la **hoja de valoraciones de un curso en un período**:
   `{ courseId, period, tenantId, entries: [{ studentId, rating }], version }`. Se
   persiste como **filas por `(curso, período, alumno)`**, pero se captura y
   guarda **atómica** con `PUT /courses/:courseId/trajectory-assessments/:period`
   (un item de cola por curso y período; §1.3: el ritual es un acto). Invariantes:
   `studentId` **único** dentro de la hoja, `rating` del enum, `version` ≥ 1.
   `PUT` reemplaza la hoja completa, con token `baseVersion` y política `lww`. La
   hoja **puede** tener cero entradas (curso sin valoraciones, §8): es válida y
   limpia las valoraciones del período.
6. **Ventanas de mayo/octubre: se difieren.** F-03 es **captura**: no introduce
   **ninguna** fecha ni ventana. §7.8/T18 prohíben hardcodearlas y asumir un
   calendario fijo; cuando una feature las necesite (F-12 cierre, F-15 calendario,
   avisos), saldrán de **`kernel-config` (D19)** por escuela. Introducirlas ahora
   sería configuración **sin consumidor real** (ODD #1). F-03 **no crea** una clave
   de config ni un enum de períodos: el `period` es la referencia opaca.
7. **Token y política de conflicto.** Se reusa ADR 0010 sin re-litigar: `version`
   entero **monótono** por hoja, expuesto como `String(version)` en el header
   **`X-Sync-Base-Version`** (ADR 0008 punto 5), política **`lww`** (T10, sync
   §8.3). Sin `baseVersion`, la operación no versiona y se aplica.
8. **Mecánica del agregado** (citas a decisiones ya cerradas): invariantes en el
   dominio (D6); **puerto por agregado**, nunca `Repository<T>`; **entidad de
   persistencia + mapper explícito** (D7); evento en el **outbox** dentro de la
   **misma transacción** (`trajectory-assessment.recorded`; D9/D10); **UUIDv7
   generado en el dominio** (D8) —la hoja no tiene id propio: su clave es
   `(curso, período)`.
9. **Alcance (T1: el tenant es el docente).** Cada tabla lleva `tenant_id` y
   **RLS** (backstop, D12/scope §9); el repositorio aplica el **predicado de
   tenant** desde el `ScopeContext` vía `TransactionContext` —el puerto no recibe
   el alcance (§4.1, D11)—. Tenant **plano** (D25).
10. **Migración propia** de la vertical, `migrations/0004-trajectory-assessment.sql`,
    incremental y forward-only (`evolution.md` §3–§5). El kernel **no** migra
    tablas de la vertical, ni al revés.
11. **Captura offline.** Se extiende la **política offline** y la fachada
    `ClassSessionSync` de la vertical (ADR 0011/0012): encolable `PUT
    /courses/:courseId/trajectory-assessments/:period`; el cliente sigue
    **parametrizado por puertos** y **sin navegador** (D4, ADR 0008). La
    convergencia se prueba en el arnés de la vertical
    (`apps/teacher-service/test/sync/`), **no** en `kernel-conformance` (frontera
    `kernel-does-not-import-apps`, D15).
12. **Se reconcilia §3.1 del documento de producto.** §3.1 lista la `Valoración`
    con la rama *"| final numérica"* colgando de `Matrícula`; el código de F-02 ya
    realiza esa numérica final como `Evaluación → Nota`. Este ADR **edita §3.1**
    para que `Valoración` quede como la **preliminar cualitativa `TEA/TEP/TED`** y
    anota que la **numérica final** vive en `Evaluación → Nota` (F-02); ajusta en
    el mismo sentido la línea de §3.4. A diferencia de ADR 0012 (punto 13, que no
    editó §3), acá **sí** se edita porque hay una reconciliación **pendiente**: §3.1
    no puede seguir nombrando una única entidad con dos ramas cuando una de ellas
    ya tiene dueño en el código.

## Consecuencias

- **Se gana** F-03 completo: la valoración preliminar cualitativa capturable
  **offline** con la cola + idempotencia del kernel, convergiendo (fase 5) y **sin
  tocar `packages/*`** — la vertical solo extiende su `OfflinePolicy` y su fachada
  `ClassSessionSync` (D15, ADR 0008).
- **Se gana** la velocidad del ritual (§1.3): marcar las valoraciones de un curso
  en un período es **un** acto (un item de cola atómico), no N escrituras.
- **Se gana** que §3.1 deja de ser contradictorio: la `Valoración` queda con **un
  único** dueño de cada rama (preliminar cualitativa acá; final numérica en F-02).
- **Se gana** un modelo que respeta las prohibiciones duras: el alumno por
  **legajo**, no por posición (§7.4); el valor como **enum cerrado** (§3.4/§13.1);
  **ninguna** fecha ni ventana hardcodeada (§7.8/T18); la planilla/informe siguen
  siendo **vistas derivadas** (T6).
- **Se gana** coherencia con ADR 0010/0011/0012: mismo `version` entero, mismo
  header, misma política `lww`, mismo patrón de agregado batch
  (`ClassAttendance`/`GradeSheet`).
- **Se paga** que `courseId`/`studentId` son referencias **colgantes** hasta que se
  modelen `Curso` (futuro) y `Alumno` (F-06); y que §3.1 ubica la `Valoración` bajo
  `Matrícula` mientras acá se la keya por `(curso, período)` —el eje del ritual de
  aula—: se documenta como limitación del corte mientras `Matrícula` no exista
  (F-06).
- **Se paga** que el `period` es un texto opaco, no un enum: es deliberado
  mientras el calendario institucional (T18/F-15) no sea un dato modelado; fijarlo
  ahora hardcodearía el calendario.
- **Fuera de alcance:** UI/`kernel-ui` (T24); el adaptador IndexedDB; `Curso`,
  `Alumno`, `Matrícula` y `Calendario`; la **valoración numérica final** (F-02); el
  informe de valoración preliminar y su envío a las familias (§6, F-14); las
  ventanas de mayo/octubre y su configuración (`kernel-config`, D19); el cálculo de
  riesgo (T6/§3.5, F-16); la edición/borrado más allá de la captura.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Modelar también la **numérica final** como `Valoración` | Solaparía/supersedería `Nota` (F-02) y re-litigaría ADR 0012; la numérica final ya tiene dueño (`Evaluación → Nota`) |
| Dejar §3.1 **sin reconciliar** (solo anotar en el ADR) | Mantendría dos ramas de la misma entidad con dueños distintos: contradicción viva entre doc y código; la reconciliación es una edición barata y explícita |
| `Valoración` como **fila por `(curso, período, alumno)`**, N items de cola | Rompe la velocidad del ritual (§1.3: marcar el curso es un acto) y multiplica los items; `lww` por fila no aporta |
| `Valoración` como **batch sin agregado** | Pierde invariantes (alumno duplicado, valor fuera del enum) y un token de versión natural |
| `rating` como **texto libre** o con valor por defecto | Sin invariante; §3.4/§13.1 fijan TEA/TEP/TED y el default silencioso ocultaría una valoración no marcada |
| `Valoración` **con fecha** de negocio | §3.1 la define `(período, tipo)`; la trazabilidad ya la da el `occurredAt` del outbox. Ampliaría §3 sin consumidor |
| `period` como **enum `C1`/`C2`** | Hardcodearía el calendario institucional, que es **configurable por escuela** (T18, §7.8); debe ser referencia opaca hasta modelarlo (F-15) |
| Ventanas de mayo/octubre **en `kernel-config` ahora** | Sin consumidor real en la captura (ODD #1); §7.8/T18 prohíben hardcodear. Se difieren al feature que las usa (F-12/F-15) |
| Cuelga la `Valoración` de una **`Matrícula` modelada ahora** | Metería F-06 en F-03 (`CONTRIBUTING` §7) y contradice ODD #1; referir por `(curso, período)` opaco alcanza para el ritual de mitad de cuatrimestre |
| Fijar el token/política en el kernel | Prohibido por ADR 0002 §4 y ADR 0008 punto 5 (pre-diseñaría el modelo de la vertical) |
