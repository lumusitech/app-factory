# 0016 — Cierre de período (F-12 parcial): nota automática, override manual y vista derivada

- **Estado:** propuesto
- **Fecha:** 2026-10-30
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D4, D6, D7, D8, D9, D10, D11,
  D12, D13, D15, D19, D22, D23, D25), §4, §6, §7 (fase 5);
  `docs/teacher-service-context.md` §1.3, §2 (T4, T6, T10, T16, T24, T25), §3.1,
  §3.4, §3.5, §4 (F-02, F-05, F-12), §7.1, §7.4, §7.8, §7.9, §8, §13.2;
  `docs/contracts/sync.md` §8, `docs/contracts/scope.md` §9,
  `docs/contracts/evolution.md` §3–§5;
  [ADR 0007](0007-decisiones-kernel-config.md),
  [ADR 0010](0010-token-version-sync-teacher-service.md),
  [ADR 0011](0011-captura-de-clase-f-01.md),
  [ADR 0012](0012-calificaciones-f-02.md),
  [ADR 0013](0013-valoracion-preliminar-f-03.md),
  [ADR 0014](0014-planilla-oficial-f-04.md),
  [ADR 0015](0015-trayectoria-del-alumno.md);
  PR de F-12 (cierre de período).

## Contexto

La fase 5 (§7) ya entregó `Clase` (`ClassSession`, ADR 0010), su captura offline
con convergencia (Slice B), F-01 (asistencia, tema y tarea; ADR 0011), F-02
(calificaciones numéricas offline; ADR 0012), F-03 (valoración preliminar
TEA/TEP/TED; ADR 0013), F-04 (planilla oficial PBA en PDF como vista derivada;
ADR 0014) y F-05 (registro/trayectoria del alumno; ADR 0015). F-12
(`docs/teacher-service-context.md` §4 v2) pide el **cierre de cuatrimestre**
(*checklist + artefactos en un click*); este ADR cubre la parte **F-12 parcial**:
el **cierre de período**, es decir **la calificación que va a la planilla impresa**
que llena el docente (§13.3).

Los hechos que enmarcan la decisión ya están escritos y no se re-litigan:

- **T6 / §3.5 / §7.1.** La planilla es una **vista derivada**; **nunca** una tabla
  editable. El cierre **no** es una excepción: la nota que va a la planilla se
  **deriva** de las causas persistidas.
- **ADR 0015 §7.** Dejó escrito, como referencia explícita para el cierre: *"el
  automático será el **promedio simple** de las notas con valor; las actividades
  sin nota se ignoran. El `weight` de ADR 0012 **no** se expone (queda en 1). Este
  ADR **no** implementa el cierre."* → el automático sale de `GradeSheet` (F-02).
- **ADR 0015 §5.** `GradeSheet` (F-02) sigue siendo la **nota vigente** que
  alimenta el promedio; el **registro** (`StudentRecord`) **documenta** la
  evolución (entradas `kind='evaluacion'`, "la última nota manda"). El cierre
  **consume** el registro para mostrar la evolución y **no** re-litiga F-02.
- **ADR 0012§3 / ADR 0013§4.** `period` es un **texto opaco** (referencia al
  período del calendario institucional): no se hardcodea `C1`/`C2` (§7.8/T18).
- **T16 / §3.2 / §7.8 / §7.9.** Escala entera 1–10; umbrales **por instancia**
  (regular = 7, intensificación = 4) y **configurables**, nunca hardcodeados.
- **ADR 0010–0015.** Patrón de **agregado batch** (clave por tupla, filas por
  hijo, `PUT` atómico, `version` entero mono-`lww`, `X-Sync-Base-Version`, outbox
  en la misma transacción, `tenant_id` + RLS, migración propia forward-only).

Al construir el cierre aparecen puntos que ni §3 ni las `D*`/`T*` cierran:

1. **Qué se persiste.** El override manual del docente es una **causa** (una
   decisión); el automático es un **resultado**. ¿Se persiste el override, el
   automático, o ambos?
2. **La forma del agregado.** §3.1 no nombra el cierre: ¿batch por
   `(curso, período)` (como `ClassAttendance`/`GradeSheet`/`TrajectoryAssessment`)
   o por `(matrícula, período)`? `Matrícula` **no** existe (F-06).
3. **La “nota efectiva + estado”.** ¿Es un **read model derivado** (T6) o un
   estado persistido?
4. **La condición (aprobado/intensificación).** T16 la define por instancia, pero
   la **instancia** (regular vs intensificación) y el **calendario** no están
   modelados (F-15): ¿entra ahora con `kernel-config` o se difiere?
5. **La evolución.** ¿El cierre **surfacea** la evolución del registro o la deja
   al endpoint de F-05?

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y `CONTRIBUTING.md` §6 ("si toqué el modelo de datos, paré y
propuse un ADR antes de escribir código"). **No duplica** lo que ya vive en
§3/§3.5 ni en D6–D13: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para el cierre de período (F-12 parcial).

1. **Alcance: la nota del cierre; no la condición.** F-12 parcial modela la
   **nota de cierre por `(curso, período, alumno)`** (automática + override
   manual) como insumo de la planilla impresa. La **planilla imprimible**
   (vista derivada de asistencia + notas + informes + cierre) y el **checklist**
   de F-12 completo son un **slice posterior**. `Curso`, `Alumno`, `Matrícula` y
   `Calendario` **no** se modelan: siguen difiriéndose a sus features (F-06/F-15).
2. **`PeriodClosing` — agregado batch por `(curso, período)`.** El agregado es el
   **conjunto de overrides manuales** de un curso en un período:
   `{ courseId, period, tenantId, entries: [{ studentId, value, motive }], version }`.
   Se persiste como **filas por `(curso, período, alumno)`**, pero se captura y
   guarda **atómica** con `PUT /courses/:courseId/period-closings/:period` (un
   item de cola por curso y período; §1.3: el ritual es un acto). Invariantes:
   `studentId` **único** dentro de la hoja, `value` **entero 1–10** (T16),
   `motive` opcional (texto acotado), `version` ≥ 1. `PUT` reemplaza la hoja
   completa, con token `baseVersion` y política `lww`. La hoja **puede** tener
   cero entradas: es válida y quita todos los overrides del período.
3. **Se persiste solo el override; el automático se calcula al vuelo.** El
   override es la **causa** que el docente decide; el automático es un
   **resultado derivado** (T6/§7.1) y **no** se almacena. Se usa el mismo criterio
   que la planilla (ADR 0014): persistir el resultado lo desincronizaría de sus
   fuentes.
4. **El automático es el promedio simple de las notas vigentes del período.** Por
   `(curso, período, alumno)`, el automático es el **promedio simple** de las
   notas **vigentes** de `GradeSheet` (F-02) de las evaluaciones **de ese
   período**; las actividades **sin nota se ignoran**. El `weight` de
   `Evaluation` **no** se expone (queda en 1, ADR 0015 §7). El resultado se
   **redondea a entero half-up** (mismo criterio que F-04, ADR 0014 §8; escala
   entera 1–10, T16). Sin evaluaciones con nota, el automático es `null` (celda
   vacía; **nunca** 0).
5. **La “nota efectiva + estado + motivo + evolución” es un read model derivado
   (T6).** Por `(curso, período, alumno)`: `effective = override ?? automatic`;
   `state ∈ { automática, manual }` (`manual` si hay override, `automática` si
   no); `motive` (solo si `manual`); y la **evolución** del registro (punto 6).
   No hay tabla de planilla ni de “nota efectiva” (§7.1). Sin nota ni override,
   `effective` es `null` y el estado es `automática`.
6. **La evolución se consume del registro (ADR 0015 §5).** El read model reúne,
   por alumno, las entradas `kind='evaluacion'` de `StudentRecord`, agrupadas por
   `evaluationId`, con **“la última entrada con nota manda”**: es la evolución del
   trabajo que el docente necesita para decidir el override. El registro
   **documenta**; `GradeSheet` sigue siendo la nota vigente. No se unifica ni se
   re-litiga F-02.
7. **Alcance (T1: el tenant es el docente).** Cada tabla lleva `tenant_id` y
   **RLS** (backstop, D12/scope §9); el repositorio/read model aplican el
   **predicado de tenant** desde el `ScopeContext` vía `TransactionContext` —el
   puerto no recibe el alcance (§4.1, D11)—. Tenant **plano** (D25). Sin alcance,
   `SCOPE_MISSING`.
8. **La condición (aprobado ≥7 / intensificación ≥4) se difiere.** F-12 parcial
   **no** calcula aprobado/intensificación y **no** registra ninguna clave en
   `kernel-config` (D19/ADR 0007). Razón: T16 fija umbrales **por instancia**, y
   aplicar el umbral correcto exige saber si el período es un **cuatrimestre
   regular** (7) o una **intensificación** (4), noción del **calendario** que no
   está modelada (F-15/T18). Un único umbral **violaría §7.9/T16**; introducir la
   clave ahora sería **configuración sin consumidor real** (ODD #1). La
   condición entra con **F-10/F-11/F-13** o cuando el calendario (F-15) modele la
   instancia.
9. **Token y política de conflicto.** Se reusa ADR 0010 sin re-litigar: `version`
   entero **monótono** por hoja, expuesto como `String(version)` en el header
   **`X-Sync-Base-Version`** (ADR 0008 punto 5), política **`lww`** (T10, sync
   §8.3). Sin `baseVersion`, la operación no versiona y se aplica.
10. **Mecánica del agregado** (citas a decisiones ya cerradas): invariantes en el
    dominio (D6); **puerto por agregado**, nunca `Repository<T>`; **entidad de
    persistencia + mapper explícito** (D7); evento en el **outbox** dentro de la
    **misma transacción** (`period-closing.recorded`; D9/D10); **UUIDv7 generado
    en el dominio** (D8) —la hoja no tiene id propio: su clave es
    `(curso, período)`.
11. **Migración propia** de la vertical, `migrations/0006-period-closing.sql`,
    incremental y forward-only (`evolution.md` §3–§5). El kernel **no** migra
    tablas de la vertical, ni al revés.
12. **Captura offline.** Se extiende la **política offline** y la fachada
    `ClassSessionSync` de la vertical: encolable `PUT
    /courses/:courseId/period-closings/:period`; el cliente sigue
    **parametrizado por puertos** y **sin navegador** (D4, ADR 0008). La
    convergencia se prueba en el arnés de la vertical
    (`apps/teacher-service/test/sync/`), **no** en `kernel-conformance` (frontera
    `kernel-does-not-import-apps`, D15).
13. **Se edita §3.1/§3.5 del documento de producto.** §3.1 gana el nodo `Cierre`
    (el override manual como causa) y §3.5 gana la derivación del cierre. A
    diferencia de ADR 0010/0012 (donde `version`/la forma batch son artefactos
    técnicos), acá el override es **modelo de producto** y debe quedar en §3,
    como en ADR 0011/0013.

## Consecuencias

- **Se gana** F-12 parcial: la nota de cierre por `(curso, período, alumno)`,
  capturable **offline** con la cola + idempotencia del kernel, convergiendo y
  **sin tocar `packages/*`** — la vertical solo extiende su `OfflinePolicy` y su
  fachada `ClassSessionSync` (D15, ADR 0008).
- **Se gana** que el docente pueda **pisar** la automática con una manual, con
  **motivo** y estado visible, respetando la velocidad del ritual (§1.3: el
  cierre es un acto por curso y período, no N escrituras).
- **Se gana** un modelo que respeta las prohibiciones duras: la planilla y el
  cierre son **vistas derivadas** (T6/§7.1); el alumno por **legajo**, no por
  posición (§7.4); **cero** umbrales hardcodeados y **ninguna** condición única
  (§7.8/§7.9/T16); `period` opaco, sin calendario hardcodeado; se consume el
  **registro** sin re-litigar F-02.
- **Se gana** coherencia con ADR 0010–0015: mismo `version` entero, mismo header,
  misma política `lww`, mismo patrón de agregado batch y de read model
  (`OfficialSheetReadModel`).
- **Se paga** que `courseId`/`studentId` son referencias **colgantes** hasta que
  se modelen `Curso` (futuro) y `Alumno` (F-06); y que la **condición** y la
  **planilla imprimible** quedan **diferidas** (F-10/F-11/F-15 y el slice de
  impresión).
- **Se paga** un **read model cross-agregado** acoplado al esquema de F-02/F-05
  (joins por `course_id`/`evaluation_id`): es la forma honesta de una vista
  derivada sin modelo analítico (mismo costo asumido en ADR 0014).
- **Fuera de alcance:** UI/`kernel-ui` (T24); la **planilla imprimible** y el
  **checklist** de F-12 completo; la **condición** aprobado/intensificación y los
  **umbrales/ventanas** en `kernel-config` (F-10/F-11/F-15); `Curso`, `Alumno`,
  `Matrícula`, `Calendario` (F-06/F-15); la **intensificación** (F-10/F-11); el
  cálculo de **riesgo** (F-16).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| **Persistir también el automático** | Es un **resultado derivado** (T6/§7.1): almacenarlo lo desincroniza de sus fuentes (las notas de F-02). Se persiste la causa (override), no el cálculo |
| **Persistir la “nota efectiva”** como estado | Viola T6/§7.1 ("nunca una tabla editable"); la efectiva se **deriva** de `override ?? automático` |
| Cierre por **`(matrícula, período)`** | Requiere modelar `Matrícula` (F-06); metería F-06 en F-12 (`CONTRIBUTING` §7) y contradice ODD #1 |
| Cierre como **fila por `(curso, período, alumno)`**, N items de cola | Rompe la velocidad del ritual (§1.3: cerrar el curso es un acto) y multiplica los items; `lww` por fila no aporta |
| Cierre como **batch sin agregado** | Pierde invariantes (alumno duplicado, valor fuera de rango) y un token de versión natural |
| **Promedio ponderado** (usar `weight`) | ADR 0015 §7: la planilla real no usa pesos; el simple es lo que espera el docente |
| Promedio **con decimales** | La escala/planilla usa **enteros** (T16); half-up es la presentación (mismo criterio que F-04) |
| **Calcular la condición** (≥7 / ≥4) ahora | Necesita los umbrales **por instancia** (T16); la instancia/calendario no está modelada (F-15) y un único umbral viola §7.9. Configuración sin consumidor (ODD #1) |
| Umbrales en **`kernel-config` ahora** | Sin consumidor real (ODD #1); §7.8/§7.9 prohíben hardcodear o asumir un mínimo único. Se difieren a F-10/F-11/F-15 |
| **Reutilizar `GradeSheet`** para el override | Mezcla "nota vigente de una evaluación" (F-02) con "nota de cierre del período" (decisión del docente); distinta semántica, distinto agregado |
| **`period` como enum `C1`/`C2`** | Hardcodearía el calendario institucional, configurable por escuela (T18, §7.8); debe seguir siendo referencia opaca hasta modelarlo (F-15) |
| **No consumir el registro** (dejar la evolución a F-05) | El docente decide el override mirando la evolución del trabajo; ADR 0015 §7 previó que el cierre consumiera el registro. Se expone en la misma vista |
| **Unificar nota vigente e historial** | Refactorizar F-02 sería más riesgo (ADR 0015 §5): la duplicación nota-actual vs. historial es deliberada y explícita |
| Fijar el token/política en el kernel | Prohibido por ADR 0002 §4 y ADR 0008 punto 5 (pre-diseñaría el modelo de la vertical) |
