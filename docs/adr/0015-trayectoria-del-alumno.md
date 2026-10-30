# 0015 — Trayectoria del alumno (registro): observaciones, evolución y movimientos

- **Estado:** propuesto
- **Fecha:** 2026-10-30
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.4, §3 (D4, D6, D7, D8, D9, D10,
  D11, D12, D13, D22, D23, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §1.3, §2 (T4, T6, T10, T19, T20, T24, T25), §3.1, §3.4, §3.5, §4, §6, §7.4,
  §7.8, §9; `docs/contracts/sync.md` §8, `docs/contracts/scope.md` §9,
  `docs/contracts/evolution.md` §3–§5;
  [ADR 0010](0010-token-version-sync-teacher-service.md),
  [ADR 0011](0011-captura-de-clase-f-01.md),
  [ADR 0012](0012-calificaciones-f-02.md),
  [ADR 0013](0013-valoracion-preliminar-f-03.md),
  [ADR 0014](0014-planilla-oficial-f-04.md);
  PR de F-05 (trayectoria del alumno).

## Contexto

La fase 5 (§7) ya entregó F-01 (asistencia, tema y tarea), F-02 (calificaciones),
F-03 (valoración preliminar TEA/TEP/TED) y F-04 (planilla oficial en PDF). El
objetivo de producto es la **planilla de uso diario** del docente: tomar
asistencia, cargar notas parciales y **hacer seguimiento** del alumno.

La referencia funcional es una planilla real de Google Sheets (asistencia por
fecha + actividades por instrumento + `TEA/TEP/TED` + cierre + comentarios por
celda). El `RITE` lo completa **dirección**, no el docente (§13.3): el artefacto
del docente es la **planilla impresa** que llena con calificaciones y cierre por
período. La app **no** integra ninguna de las dos (T8).

De esa referencia y de las decisiones de producto surgen necesidades que **ni §3
ni las `D*`/`T*` cierran**:

1. **Seguimiento longitudinal del alumno.** El docente necesita registrar, por
   alumno, **observaciones globales** (rendimiento, dificultades, acompañamiento,
   salud, conducta, cuaderno de comunicados) que **sobrevivan al curso y al año**,
   para reconstruir la trayectoria y ajustar la intensificación. Hoy no existe
   entidad para esto.
2. **Evolución por trabajo, con fechas.** Un TP se entrega, se devuelve con lo
   que hay que corregir y **se reentrega**; cada paso es un hecho con **fecha y
   detalle**, y **la última nota manda** (una buena primera nota puede ser
   casualidad; la recorrección revela el dominio real). §3.1 nombra un `Registro`
   bajo `Matrícula`, sin definirlo; **ADR 0012** fija que la `Nota` **no** lleva
   fecha. Hay que decidir **dónde vive la evolución con fechas**.
3. **Movimientos de alumnos** (traslado/baja entre cursos o escuelas por
   conducta, horarios, trabajo o mudanza de la familia): el alumno **deja de
   recibir seguimiento** pero **debe quedar el motivo**. `Matrícula` no está
   modelada (F-06).
4. **`S/C` ("sin calificar")**: convención de las planillas para "no fue
   calificado" (ausente o evaluación pendiente).

Este ADR es el evento explícito que exige D23.2 y `CONTRIBUTING.md` §6 ("si toqué
el modelo de datos, paré y propuse un ADR antes de escribir código"). **No
duplica** lo de §3 ni de D6–D13: fija solo lo que falta. El **cierre de período**
(promedio automático + override manual) consume este registro y se decide en un
ADR posterior (F-12).

## Decisión

Se adoptan las siguientes resoluciones.

1. **Alcance: el registro es de captura (dato), no una vista.** Se introduce el
   agregado **`StudentRecord`** (`Registro` de §3.1) como un **log append-only**
   por alumno. La **planilla de uso diario** sigue siendo una **vista derivada**
   (T6/§7.1); este ADR **no** la persiste ni la vuelve editable.
2. **`StudentRecord` — entry create-only, por `(tenant, studentId)`.** Cada
   instancia es **un hecho** del registro: `{ id, tenantId, studentId, kind,
   occurredOn, note, category, evaluationId, grade, version }`. Es **solo
   creación** (inmutable): corregir un hecho es **agregar otro**, no editarlo (de
   ahí "no fecha, **fechas**"). `studentId` es el **legajo interno** (T4), una
   referencia **opaca** y **estable**, nunca la posición (§7.4); sin clave foránea
   porque `student`/`evaluation` no existen (ADR 0010).
3. **Kinds de entrada: `observacion` · `movimiento` · `evaluacion`.** Invariantes
   validados en el dominio y reforzados en la base:
   - `observacion`: `note` **obligatoria**; `category` opcional (`rendimiento`,
     `dificultades`, `acompañamiento`, `salud`, `conducta`, `comunicados`, …),
     texto libre acotado.
   - `movimiento`: `note` **obligatoria** (el motivo: traslado/baja, conducta,
     mudanza…); `category` opcional.
   - `evaluacion`: `evaluationId` **obligatoria**; `note` y `grade` opcionales;
     `grade` entera **1–10** (T16) cuando está.
   En **todos** los casos `occurredOn` es una **fecha de calendario** válida
   (`YYYY-MM-DD`, `isValidCalendarDate`). `evaluationId`/`grade` **solo** en
   `evaluacion` (`CHECK` en la base). Un valor fuera de rango es
   **`400 VALIDATION_ERROR`** y, offline, el item queda **`blocked`** (sync §4).
4. **Observaciones y movimientos son globales (por alumno), no por curso.** El
   eje es el **legajo** (T4), de modo que la trayectoria **cruza cursos y años** —
   es lo que permite reconstruir cómo el alumno enfrentó distintos trabajos y
   ajustar la intensificación. El **movimiento** se modela como un `kind` propio
   (marca "deja de recibir seguimiento"), **sin** modelar `Matrícula` (F-06).
5. **La evolución con fechas vive en el registro; la nota actual sigue en F-02.**
   La **evolución** de un trabajo es la secuencia de entradas `evaluacion` de ese
   `evaluationId` (cada una con `occurredOn`, `note` y, si corresponde, un
   **snapshot** de `grade`). La **nota vigente** de un trabajo es **la última
   entrada con nota** (la recorrección manda). El agregado `GradeSheet` (F-02,
   ADR 0012) **sigue siendo la nota actual** que alimenta el promedio y la
   impresión; el registro **documenta** el detalle y la evolución. **No se
   unifica** (refactorizar F-02 sería más riesgo); la duplicación —nota actual vs.
   su historial— es **deliberada y explícita**.
6. **`S/C` es presentación, no un estado nuevo.** "Sin calificar" se **muestra**
   cuando no hay nota; en el modelo, la ausencia de nota es la ausencia de una
   entrada con `grade`. No se agrega un valor de estado.
7. **Promedio simple (referencia para el cierre, F-12).** Cuando el cierre de
   período consuma el registro, el automático será el **promedio simple** de las
   notas con valor; las actividades **sin nota se ignoran**. El `weight` de
   ADR 0012 **no** se expone (queda en 1). Este ADR **no** implementa el cierre.
8. **Sin duplicar identidad: `Alumno` (F-06) queda fuera.** El registro se keyea
   por `studentId` (legajo) opaco. La **búsqueda por nombre** (fuzzy con
   resaltado) **depende de F-06** y se **difiere**; acá solo se cuidan los campos
   buscables (legajo, categoría, texto).
9. **La dimensión del “radar” (fortalezas/debilidades) se difiere.** Etiquetar
   las actividades por eje (Ritmo, Melodía, …) habilitaría métricas derivadas; hoy
   es **configuración/dato sin consumidor** (ODD #1). Se difiere.
10. **Mecánica (citas a decisiones cerradas).** Invariantes en el dominio (D6);
    **puerto por agregado**, nunca `Repository<T>`; **entidad de persistencia +
    mapper explícito** (D7); **UUIDv7** generado en el dominio (D8) —el `id` lo
    puede aportar el **cliente** para capturar offline—; evento en el **outbox**
    dentro de la **misma transacción** (`student-record.recorded`; D9/D10);
    **alcance** por `tenant_id` + **RLS** backstop y predicado desde el
    `ScopeContext` vía `TransactionContext` (D11/D12, scope §9), tenant **plano**
    (D25); **migración propia** `migrations/0005-student-record.sql`, incremental
    y forward-only (`evolution.md` §3–§5).
11. **Captura offline.** Se extiende la **política offline** y la fachada
    `ClassSessionSync` de la vertical: encolable `POST /students/:studentId/records`
    (el cliente sigue **parametrizado por puertos** y **sin navegador**; D4,
    ADR 0008). La convergencia se prueba en el arnés de la vertical
    (`apps/teacher-service/test/sync/`), **no** en `kernel-conformance` (frontera
    `kernel-does-not-import-apps`, D15).
12. **Ajuste de §13.3 y de la salvedad de F-04.** Se anota que el `RITE` lo
    completa **dirección** y que el artefacto del docente es la **planilla
    impresa** con calificaciones y cierre por período; la app no integra (T8).

## Consecuencias

- **Se gana** el **seguimiento longitudinal**: observaciones y movimientos por
  alumno, que cruzan cursos y años (T4/T20), como base de la trayectoria y de la
  intensificación ajustada (F-11).
- **Se gana** la **evolución con fechas** por trabajo, con "la última nota manda",
  reemplazando los **comentarios de celda** de la planilla por datos estructurados
  (habilitando métricas futuras sin comprometerlas).
- **Se gana** no re-litigar F-02: `GradeSheet` sigue siendo la nota actual; el
  registro es aditivo.
- **Se gana** coherencia con ADR 0010–0014: `version` entero, header
  `X-Sync-Base-Version`, política `lww`, misma mecánica de agregado/puerto/mapper/
  outbox/alcance.
- **Se paga** una **duplicación deliberada**: la nota actual (`GradeSheet`) y su
  historial (entradas `evaluacion`) pueden describir el mismo hecho; se documenta
  y se mantiene por simplicidad y reversibilidad.
- **Se paga** que `studentId` es una referencia **colgante** (sin `Alumno` hasta
  F-06): la búsqueda por nombre queda **diferida**.
- **Se paga** que el **cierre de período** (promedio automático + override manual,
  la nota que va a la planilla impresa) **no** entra acá: es el siguiente ADR
  (F-12).
- **Fuera de alcance:** UI/`kernel-ui` (T24); la planilla de uso diario
  **imprimible** (vista derivada, slice posterior); el **cierre de período** y su
  override (F-12, ADR siguiente); `Alumno`/`Matrícula`/`Curso`/`Calendario`
  (F-06/F-15); la **búsqueda fuzzy** (F-06 + UI); la **dimensión/radar**; la
  **intensificación** (F-10/F-11); la integración con el **RITE/sistema
  provincial** (T8/§13.3).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| **Planilla como tabla editable** persistida | Viola T6/§7.1 ("nunca una tabla editable"); el registro captura **hechos**, la planilla se **deriva** |
| **Un solo motivo por nota** (sin línea de tiempo) | Pierde la **evolución** que el docente necesita (entregas/reentregas con fechas) |
| **Reutilizar `GradeSheet` con un campo de nota** (unificar) | Refactoriza F-02 y mezcla "nota actual" con "historial"; mayor riesgo, menos reversibilidad (ODD) |
| **Modelar `Alumno`/`Matrícula` ahora** | Metería F-06 en esta feature (`CONTRIBUTING` §7); el `legajo` opaco alcanza para observaciones y movimientos |
| **Guardar la fecha en la `Nota`** (`GradeSheet`) | ADR 0012 fijó que la `Nota` no lleva fecha; la evolución es **una secuencia de hechos**, no un campo |
| **`movimiento` como estado de `Matrícula`** | `Matrícula` no está modelada; un `kind` propio evita adelantar F-06 |
| **Observaciones por curso** | Rompe la trayectoria **entre años** (T4/T20), que es el objetivo |
| **`S/C` como valor/estado** | No aporta al modelo: la ausencia de nota ya lo expresa; es **presentación** (con tooltip/expansión) |
| **Promedio ponderado** (usar `weight`) | La planilla real no usa pesos; el simple es lo que espera el docente |
| **Dimensión/radar y búsqueda fuzzy ahora** | Sin consumidor real (ODD #1): la dimensión es dato sin uso hasta que haya métricas; la búsqueda necesita F-06 + UI |
| **Integrar RITE / cargar la planilla oficial automáticamente** | Prohibido (T8/§13.3); el RITE lo completa dirección |
