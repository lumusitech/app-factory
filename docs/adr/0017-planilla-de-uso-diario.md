# 0017 — Planilla de uso diario imprimible: vista derivada, plantilla como dato y render en servidor

- **Estado:** propuesto
- **Fecha:** 2026-10-30
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.4, §2, §3 (D4, D6, D7, D11, D12,
  D15, D18, D19, D22, D23, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §1.3, §2 (T4, T6, T7, T8, T10, T16, T24, T25), §3.1, §3.4, §3.5, §4 (F-04, F-05,
  F-12), §6, §7.1, §7.4, §7.8, §8, §13.2, §13.3; `docs/contracts/sync.md` §8,
  `docs/contracts/scope.md` §9, `docs/contracts/evolution.md` §3–§5,
  `docs/contracts/not-extracted.md` §5;
  [ADR 0007](0007-decisiones-kernel-config.md),
  [ADR 0010](0010-token-version-sync-teacher-service.md),
  [ADR 0011](0011-captura-de-clase-f-01.md),
  [ADR 0012](0012-calificaciones-f-02.md),
  [ADR 0013](0013-valoracion-preliminar-f-03.md),
  [ADR 0014](0014-planilla-oficial-f-04.md),
  [ADR 0015](0015-trayectoria-del-alumno.md),
  [ADR 0016](0016-cierre-de-periodo-f-12.md);
  PR de F-04 (planilla de uso diario).

## Contexto

La fase 5 (§7) ya entregó F-01 (asistencia, tema y tarea; ADR 0011), F-02
(calificaciones numéricas offline; ADR 0012), F-03 (valoración preliminar
TEA/TEP/TED; ADR 0013), F-04 (planilla oficial PBA en PDF; ADR 0014), F-05
(registro/trayectoria del alumno; ADR 0015) y F-12 parcial (cierre de período;
ADR 0016). La **planilla de uso diario imprimible** quedó **explícitamente
diferida**: ADR 0015 §154 la nombra como *"la planilla de uso diario imprimible
(vista derivada, slice posterior)"* y ADR 0016 §81/§179 la describe como *"la
planilla imprimible (vista derivada de asistencia + notas + informes + cierre)"*.

La referencia funcional (ADR 0015 §Contexto) es una planilla real de Google
Sheets: **asistencia por fecha + actividades por instrumento + `TEA/TEP/TED` +
cierre + comentarios por celda**. Es la **contraparte "de trabajo"** de la
plantilla oficial (F-04): mientras la oficial es el **contrato de salida** que la
institución acepta, la de uso diario es la **hoja de trabajo del docente**.

Los hechos que enmarcan la decisión ya están escritos y no se re-litigan:

- **T6 / §3.5 / §7.1.** La planilla es una **vista derivada** de
  `notas + valoraciones + asistencias + matrículas`; **nunca** una tabla editable.
- **T7 / §6.** Las **plantillas** son **datos versionados** (`layout` + mapeo de
  campos), identificadas por `(jurisdicción, nivel, año)`. Cambiar el layout **no**
  debe requerir un release.
- **T8 / §6.** *Compartir es exportar* (PDF/Excel/enlace), no integrar.
- **T16 / §7.8 / §7.9.** La **condición** (aprobado ≥7 / intensificación ≥4) es por
  **instancia** y configurable: no se hardcodea ni se asume un mínimo único.
- **ADR 0016 punto 8.** La condición se **difiere** a F-10/F-11/F-15: aplicarla
  exige el calendario (F-15), no modelado.
- **D18 #3 / §1.4 / `not-extracted.md` §5.** El render de documentos (PDF) es un
  **candidato de kernel** (`kernel-documents`/`kernel-storage`) que se valida con
  la **segunda** vertical: **no** se promueve ahora.
- **§8.** *Generar PDF oficial* está marcado con **⚠️**: **no** está en la lista de
  cargas offline.

Al construir la planilla de uso diario aparecen puntos que ni §3 ni las `D*`/`T*`
cierran:

1. **Qué se deriva.** ¿De qué fuentes sale la hoja y cómo se combinan (asistencia
   por fecha + actividades del período + valoración + cierre + registro)?
2. **Dónde vive la plantilla** y qué forma tiene (T7/D19): las columnas son
   **dinámicas** (fechas, evaluaciones), así que el esquema de columnas exactas de
   F-04 no aplica tal cual.
3. **Un artefacto o dos** y **una disposición o dos** (la planilla entera del curso
   y el seguimiento de un alumno).
4. **El rango de la asistencia por fecha**: ¿parámetro opaco o hardcodeado? (§7.8).
5. **La evolución** del registro (F-05): ¿entra y cómo?
6. **La condición** (aprobado/intensificación): ¿entra?

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y `CONTRIBUTING.md` §6. **No duplica** lo que ya vive en §3/§6
ni en D6–D19: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones.

1. **Alcance: la planilla de uso diario es una vista derivada; no se persiste.**
   No crea agregado, no escribe outbox y **no agrega tablas ni migración** (T6/
   §3.5/§7.1). Se **deriva** de la asistencia (F-01), las notas (F-02), la
   valoración (F-03), el cierre (F-12) y el registro (F-05) ya persistidos, más un
   **roster derivado**. Es una operación de **lectura**: **no** entra en la cola
   offline (§8) ni lleva idempotencia.
2. **Un documento por `(curso, período)`.** El período es un parámetro **opaco**
   del pedido (no se hardcodea `C1`/`C2`; §7.8): las actividades, la valoración y
   el cierre son por período.
3. **Fuentes y composición.** Por `(curso, período, alumno)`:
   - **asistencia por fecha** (`date` → estado) — F-01;
   - **actividades del período** (`evaluationId` → nota, `null` si no hay) — F-02;
   - **valoración** TEA/TEP/TED del período — F-03;
   - **cierre** (`automática`/`efectiva`/`estado`/`motivo`) — se **reusa**
     `buildPeriodClosing` (F-12; ADR 0016 §4–§5), no se recalcula;
   - **evolución** del período — ver punto 6.
   El **roster** es la unión de los `student_id` capturados (notas, asistencia,
   valoración, override, registro), ordenada por **legajo** (determinista y
   estable; nunca por posición, §7.4).
4. **La condición (aprobado ≥7 / intensificación ≥4) se difiere.** La hoja **no**
   calcula aprobado/intensificación y **no** registra claves en `kernel-config`
   (T16/§7.8/§7.9; ADR 0016 punto 8): depende de la instancia y del calendario
   (F-15), no modelados. La hoja expone **valores**, no condiciones.
5. **La plantilla es un dato versionado en `kernel-config` (T7; D19/ADR 0007), con
   una clave propia.** Se registra `document.template.worksheet-pba-secondary-2026`,
   **distinta** de `document.template.pba-secondary-2026` (la oficial, ADR 0014).
   Como las columnas son **dinámicas**, la plantilla declara **secciones**
   (`attendance` · `activities` · `trajectory` · `closing` · `evolution`) + título
   + **cabecera** (`context.*`); las columnas dentro de cada sección se derivan de
   la vista. Se valida **fail-closed** contra un esquema **de la vertical**; el
   `default` embebido garantiza la salida *out-of-the-box* y el override por config
   cumple T7. El `ConfigSchemaRegistry` de la vertical registra la clave y su
   validador (segundo consumidor real; ADR 0007).
6. **La evolución se consume del registro (F-05), solo del período.** El read model
   reúne, por alumno, las entradas `kind='evaluacion'` del período, agrupadas por
   `evaluationId`, con **"la última entrada con nota manda"** (ADR 0015 §5; mismo
   criterio que el cierre, ADR 0016 punto 6). Las **observaciones globales**
   (ADR 0015 punto 4) **no** entran: cruzan cursos y años, y la hoja es de **un**
   curso.
7. **La asistencia por fecha usa un rango opaco `from`/`to`.** Query params
   **opacos** (sin fechas hardcodeadas, §7.8) que acotan las columnas de asistencia;
   sin rango, se toman las **clases dictadas** del curso, ordenadas. Un rango vacío
   (`from > to`) es válido y deja la hoja sin columnas de fecha.
8. **Render en servidor, determinista, con el escritor mínimo propio** (§10;
   ADR 0014 §5–§6). Mismo input + mismo reloj ⇒ mismos bytes (el `/CreationDate`
   sale del `Clock` inyectado; sin `/ID` aleatorio). **Sin** librería externa,
   **sin** puerto y **sin** promover `kernel-documents`/`kernel-storage` (D18,
   `not-extracted.md` §5). El escritor PDF mínimo se **comparte** con F-04 en un
   módulo de la vertical.
9. **Dos disposiciones, dos rutas de lectura.** `GET /courses/:courseId/worksheet.pdf`
   → **matriz** (filas = alumnos; columnas = fechas de asistencia + actividades +
   valoración + cierre) con un **anexo** de evolución. `GET
   /courses/:courseId/students/:studentId/worksheet.pdf` → **bloque** de
   seguimiento de un alumno. Ambas devuelven `application/pdf` (fuera del envelope
   JSON del kernel) y son **lecturas**: sin idempotencia ni sync. La cabecera
   (escuela, materia, división, ciclo, docente) viaja por **query params opacos**
   que la plantilla mapea (`context.*`), como F-04.
10. **Alcance (T1: el tenant es el docente).** La lectura respeta el **predicado de
    tenant** desde el `ScopeContext` vía `TransactionContext` —el read model no
    recibe el alcance (§4.1, D11)— y la base mantiene **RLS** como backstop
    (D12/scope §9). Tenant **plano** (D25). Sin alcance, `SCOPE_MISSING`.
11. **Sin cambio al modelo de datos de §3.** La planilla de uso diario ya está
    prevista como **vista derivada** (§3.5/§6): **no** se edita §3. Se actualiza
    `docs/teacher-service-context.md` **§6** para nombrar el artefacto.
12. **Tests (T25/D22).** Dominio (bordes: curso vacío, período sin notas, sin
    cierre, sin asistencia, rango vacío, orden por legajo), plantilla
    (fail-closed), render (determinismo y ambas disposiciones) y borde HTTP
    (cross-tenant, `SCOPE_MISSING`, validación, plantilla como dato). Sin
    contenedor (D4).

## Consecuencias

- **Se gana** la planilla de uso diario **sin tocar `packages/*`**: la vertical
  agrega una vista derivada, un read model, una plantilla, un render y dos rutas;
  **sin** migración, **sin** UI (T24) y **sin** promoción al kernel (D18, ODD #1).
- **Se gana** el cumplimiento de **T7**: el layout (título, cabecera, secciones) es
  **dato versionado**; cambiar la hoja **no** requiere release. `kernel-config`
  madura con un **segundo consumidor real** (ADR 0007).
- **Se gana** un render **determinista** y testeable **sin navegador** (D4) y la
  reutilización del escritor PDF mínimo y del cierre de F-12 (no se re-litiga).
- **Se gana** que la hoja respeta las prohibiciones duras: **vista derivada** (T6),
  alumno por **legajo** (§7.4), **cero** fechas/umbrales hardcodeados (§7.8),
  **ninguna** condición única (§7.9/T16) y **no** integra el sistema provincial
  (§7.6/T8).
- **Se paga** un **read model cross-agregado** acoplado al esquema de F-01/F-02/
  F-03/F-05/F-12 (joins por `course_id`/`evaluation_id`): es la forma honesta de una
  vista derivada sin modelo analítico (mismo costo asumido en ADR 0014/0016).
- **Se paga** que `courseId`/`studentId`/`period` son referencias **colgantes**
  hasta que se modelen `Curso`/`Alumno` (F-06) y `Calendario` (F-15); y que la
  **cabecera** no se persiste (viene del pedido).
- **Se paga** que el **render local/offline** (§8 ⚠️) queda **diferido**: la
  planilla requiere conexión. Asumido y explícito.
- **Fuera de alcance:** UI/`kernel-ui` (T24); la **condición** y los **umbrales/
  ventanas** en `kernel-config` (F-10/F-11/F-15); `Curso`, `Alumno`, `Matrícula`,
  `Calendario` (F-06/F-15); las **observaciones globales** en la hoja (F-05 las
  sirve aparte); **Excel/CSV** y el **enlace público** con token (T8/T9); el
  **libro de temas**; el **render en cliente**; y la **promoción** a
  `kernel-documents`/`kernel-storage` (D18).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| **Persistir la planilla de uso diario** (tabla/agregado) | Viola T6/§7.1 ("nunca una tabla editable") y crearía una copia que se desincroniza de sus fuentes |
| **Layout embebido en código** (sin `kernel-config`) | Viola el espíritu de T7 (cambiar el layout exigiría release); además no hay razón para no reusar el mecanismo de ADR 0014 |
| **Reusar la clave de la plantilla oficial** | La oficial (ADR 0014) y la de uso diario tienen **layout y columnas distintos**: misma clave mezclaría dos contratos de salida |
| **Plantilla con columnas exactas** (como F-04) | Las columnas de la hoja son **dinámicas** (fechas, evaluaciones): enumerarlas obligaría a hardcodear el calendario/planilla (§7.8) |
| **Calcular la condición** (≥7 / ≥4) en la hoja | Necesita los umbrales **por instancia** (T16) y el calendario (F-15); un único umbral viola §7.9 (ADR 0016 punto 8) |
| **Incluir las observaciones globales** del registro | Cruzan cursos y años (ADR 0015 punto 4); la hoja es de **un** curso. La evolución del período es lo pertinente |
| **Render en cliente** (PWA) | Rompe el corte delgado servidor+tests (D4), exige UI (T24) y no es testeable sin navegador; el render local se difiere (§8 ⚠️) |
| **Un solo artefacto** (solo la matriz) | El docente necesita también entregar el **seguimiento de un alumno**; se resuelve con una segunda ruta y disposición |
| **Un endpoint con `?student=`** | Selección implícita; dos rutas con una sola responsabilidad es más claro |
| **Promover `kernel-documents`/`kernel-storage` ahora** | D18/`not-extracted.md` §5: los candidatos se validan con la **segunda** vertical; hoy solo una los pide (ODD #1) |
| **Un puerto `DocumentRenderer`** | Un puerto con una implementación y un consumidor es **abstracción prematura** (ODD #1); la promoción introducirá el puerto *entonces* |
| **Librería PDF externa** | Dependencia runtime nueva sin necesidad; el escritor mínimo propio (ADR 0014) es determinista y testeable |
| **Fechas de asistencia hardcodeadas** (p. ej. el cuatrimestre) | §7.8 prohíbe hardcodear fechas; el calendario (F-15) no está modelado |
