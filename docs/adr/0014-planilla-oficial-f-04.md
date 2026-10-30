# 0014 — Planilla oficial PBA en PDF (F-04): vista derivada, plantilla como dato y render en servidor

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.4, §2, §3 (D4, D6, D7, D8, D12,
  D15, D18, D19, D22, D23, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §1.3, §2 (T6, T7, T8, T15, T16, T24, T25), §3.3, §3.5, §4 (F-04), §6, §7.1,
  §7.4, §7.8, §10, §11, §13.1, §13.2, §13.4; `docs/contracts/scope.md` §1, §6.2,
  §9; `docs/contracts/evolution.md` §3–§5; `docs/contracts/not-extracted.md` §5;
  [ADR 0007](0007-decisiones-kernel-config.md),
  [ADR 0008](0008-materializacion-kernel-client-y-conformance.md),
  [ADR 0010](0010-token-version-sync-teacher-service.md),
  [ADR 0011](0011-captura-de-clase-f-01.md),
  [ADR 0012](0012-calificaciones-f-02.md),
  [ADR 0013](0013-valoracion-preliminar-f-03.md);
  PR de F-04.

## Contexto

La fase 5 (§7) entrega `teacher-service` delgado con el criterio de salida
*"converge"*, que ya se cumple. El corte mergeado cubrió `Clase` (`ClassSession`,
ADR 0010), su captura offline con convergencia (Slice B), F-01 (asistencia, tema y
tarea; ADR 0011), F-02 (calificaciones numéricas offline; ADR 0012) y F-03
(valoración preliminar TEA/TEP/TED offline; ADR 0013). F-04
(`docs/teacher-service-context.md` §4 v1) pide la **planilla oficial PBA en PDF,
lista para imprimir y firmar**.

Los hechos que enmarcan la decisión ya están escritos y no se re-litigan:

- **T6 / §3.5 / §7.1.** La planilla es una **vista derivada** de
  `notas + valoraciones + asistencias + matrículas`, colgada de §3.5
  (`Planilla = notas + valoraciones + asistencias + matrículas mapeadas a la
  plantilla oficial`). **Nunca** una tabla editable (§7.1).
- **T7 / §6.** La **plantilla oficial** es un **contrato de salida** y un **dato
  versionado** (`layout` + `mapeo de campos`), identificado por
  `(jurisdicción, nivel, año)`. Cambiar de provincia o de año **no** debe requerir
  un release.
- **T8 / §6.** *Compartir es exportar* (PDF/Excel/enlace), no integrar. F-04 es la
  **salida PDF**; Excel/CSV y el enlace público (T9) son artefactos aparte de §6.
- **§10.** Deja **abierta** una única duda de implementación: *"Render de PDF en
  cliente vs servidor — se decide al construir F-04"*.
- **D18 #3 / §1.4.** El render de documentos (PDF) es un **candidato de kernel**
  (`kernel-documents`/`kernel-storage`), *"puerto; plantillas locales"*, que **no**
  se implementa ahora: se valida con la **segunda vertical** (`not-extracted.md` §5).
- **§8.** *Generar PDF oficial* está marcado con **⚠️** ("requiere datos completos,
  evaluar render local"): **no** está en la lista de cargas offline.
- **§13.4.** Obliga a **verificar la vigencia** del régimen de evaluación PBA
  **antes** de construir F-04.

Al construir F-04 aparecen puntos que ni §3 ni las `D*`/`T*` cierran:

1. **Qué datos faltan y cómo se cubren.** Los datos de la planilla son
   `Curso`, `Alumno`/`Matrícula`, `Calendario`, notas (F-02), valoraciones (F-03)
   y asistencias (F-01). `Curso`, `Alumno`/`Matrícula` y `Calendario` **no** se
   modelan todavía (F-06/F-15): ¿F-04 los modela, los difiere o los referencia
   opacos? Y sin `Curso`, ¿de dónde sale la **cabecera** (escuela, materia,
   división, año, docente) y el **roster** (la lista de alumnos)?
2. **Dónde vive la plantilla como dato versionado** y **qué esquema la valida**
   (T7, D19).
3. **Cliente o servidor** (§10).
4. **La nota por cuatrimestre.** §3.1/ADR 0012 dejan el **promedio ponderado**
   (uso de `Evaluation.weight`) como vista derivada "que pertenece a F-04/F-13":
   ¿F-04 lo calcula? ¿Con qué redondeo?
5. **La frontera.** ¿F-04 se queda en la vertical o cruza a
   `kernel-documents`/`kernel-storage` (D18, D15)?
6. **La vigencia normativa** (§13.4).

**Verificación de vigencia (§13.4), al 2026-10-29.** El anexo normativo de §13 se
apoya en la **Resolución 1236/23** (DGCyE). La verificación muestra que el régimen
vigente para la Educación Secundaria de la Provincia de Buenos Aires es la
**Resolución 1650/24** (*Régimen Académico*, DGCyE), con implementación progresiva
2024→2025 y planificación 2026, más la **Disposición 40/26** (complementaria /
aclaratoria, documento de apoyo, feb-2026). Confirma: **dos cuatrimestres**,
**valoración preliminar TEA/TEP/TED** a mitad de cuatrimestre, **nota numérica al
cierre**, aprueba con **≥7** e intensificación desde **4**, y **asistencia 75%**
por materia. **Difiere** de §13.2 en el número de momentos de intensificación:
el RA vigente habla de **seis** ("al inicio y cierre de cada cuatrimestre"), no de
tres. Los formularios oficiales citados por DGCyE son el *Registro Anual de
Calificaciones* y el *RITE*. **Salvedad honesta:** la **forma exacta** del
formulario oficial del ciclo en curso **no** quedó confirmada con una fuente
primaria (los resultados de búsqueda fueron ruidosos). Por eso este ADR **no**
fija la plantilla en código: la trata como **dato versionado**, corregible **sin
release** (T7), y deja el punto abierto a la confirmación de producto.

Este documento es el evento explícito que exige D23.2 ("cambiar el contrato es un
evento explícito (ADR)") y `CONTRIBUTING.md` §6. **No duplica** lo que ya vive en
§3/§6 ni en D6–D19: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para F-04.

1. **Alcance: la planilla es una vista derivada; no se persiste.** F-04 **no**
   crea un agregado, **no** escribe outbox y **no** agrega tablas (T6/§3.5/§7.1).
   La planilla se **deriva** de las notas (F-02), las valoraciones (F-03) y las
   asistencias (F-01) ya persistidas, más un **roster derivado**. Es una operación
   de **lectura**: **no** entra en la cola offline (§8) ni lleva idempotencia.
2. **Los datos faltantes se difieren; las referencias son opacas.** `Curso`,
   `Alumno`/`Matrícula` y `Calendario` **no** se modelan en F-04: siguen
   difiriéndose a sus features (F-06/F-15), como ya hizo ADR 0010/0011/0012/0013.
   `courseId` (ADR 0010), `studentId` = **legajo interno** (T4, nunca la posición;
   §7.4) y `period` (opaco, ADR 0012/0013) permanecen opacos, sin clave foránea.
3. **El roster se deriva de lo capturado.** La lista de alumnos de la planilla es
   la **unión de los `student_id` capturados** del curso (asistencias de sus
   clases, notas de sus evaluaciones y valoraciones del curso), ordenada por
   **legajo** (determinista y estable; nunca por posición, §7.4). `Alumno`
   (F-06) modelará el legajo y los datos personales; F-04 no los necesita.
4. **La cabecera es entrada opaca del pedido, no un dato persistido.** Los valores
   que hoy no se pueden derivar (escuela, materia, división, ciclo, docente) se
   reciben como **parámetros opacos** del pedido y la **plantilla** los mapea
   (`context.*`). No se modela `Curso` ni se persiste la cabecera: es una
   limitación explícita del corte, no un olvido.
5. **Render en servidor** (§10). La planilla se genera en el **servidor** como
   PDF **determinista** (reloj inyectado, sin navegador), testeable sin contenedor
   (D4). El render **local/offline** (§8 ⚠️) queda **diferido**: el PDF oficial
   requiere conexión, porque los datos completos vienen de la base.
6. **Sin puerto de render ni paquete nuevo (frontera = vertical).** El render vive
   en `teacher-service` como una **función pura** (sin puerto: un puerto con una
   sola implementación y un solo consumidor sería abstracción prematura, ODD #1,
   §7 de `CONTRIBUTING`). **No** se promueve `kernel-documents`/`kernel-storage`:
   son candidatos de D18 que se validan con la **segunda vertical** y hoy **solo**
   esta vertical los pide (`not-extracted.md` §5). La extracción al kernel —con su
   contrato y su ADR— es la promoción futura, no parte de F-04.
7. **La plantilla es un dato versionado en `kernel-config` (D19; ADR 0007).** La
   plantilla (layout + mapeo) se almacena como una **entrada de configuración por
   tenant** bajo una **clave opaca** que codifica `(jurisdicción, nivel, año)`
   (`document.template.pba-secondary-2026`). El valor se valida contra un esquema
   **de la vertical** (`ConfigSchemaRegistry`, ADR 0007): una plantilla inválida
   es un **fallo** (fail-closed). Cambiar provincia/año es cambiar **dato**, no
   código (T7). El render resuelve la plantilla **así**: la entrada del tenant si
   existe (validada), o si no un **default embebido** (dato de la vertical,
   PBA secundaria 2026). El default garantiza la salida *out-of-the-box* y el
   override por config cumple T7 (sin release). El `ConfigSchemaRegistry` de la
   vertical **registra la clave** y su validador: deja de ser un stub vacío y su
   `isValid` tiene un consumidor real (la validación en la lectura).
8. **La nota de cuatrimestre es vista derivada: promedio ponderado.** Por alumno y
   período, la nota es el **promedio ponderado** de las evaluaciones de ese período
   (peso = `Evaluation.weight`; ADR 0012 punto 3 lo asigna a F-04/F-13),
   considerando las evaluaciones que tengan nota para ese alumno, **redondeada a
   entero half-up** (la escala es entera 1–10, T16). Sin evaluaciones para el
   período, la celda queda **vacía** (no hay cero).
9. **La vista es la materia prima; la plantilla mapea.** El dominio produce una
   **vista neutra** (por alumno: valoración por período, nota por período,
   conteos de asistencia por estado). La plantilla decide **qué columnas** se
   muestran, con qué etiqueta, en qué orden y qué `context.*` va en la cabecera.
   F-04 **no** aplica umbrales (no calcula aprobado/desaprobado): eso es
   `Intensificación`/`Trayectoria` (§3.5) y requeriría los umbrales configurables
   de T16 (sin consumidor hoy, ODD #1). Nada de fechas, ventanas ni umbrales
   hardcodeados (§7.8).
10. **Salida: `GET /courses/:courseId/official-sheet.pdf`** → `application/pdf`
    (lectura; **fuera** del envelope JSON del kernel, que envuelve respuestas de
    datos; un cuerpo binario no se envuelve). Sin idempotencia ni sync (es
    lectura). La cabecera opaca viaja por query params.
11. **Alcance (T1: el tenant es el docente).** La lectura respeta el **predicado
    de tenant** desde el `ScopeContext` vía `TransactionContext` —el puerto/read
    model no recibe el alcance (§4.1, D11)— y la base mantiene **RLS** como
    backstop (D12/scope §9). Tenant **plano** (D25). Sin alcance, `SCOPE_MISSING`.
12. **Normativa.** Se construye contra el **RA vigente** (Res. 1650/24 + Disp.
    40/26), no contra la foto de Res. 1236/23. Se actualiza `docs/teacher-service-context.md`
    §13 (fuente y vigencia) y §3.3 (momentos de intensificación). La forma exacta
    del formulario oficial del ciclo queda como **dato** a confirmar (punto 7).

## Consecuencias

- **Se gana** F-04 completo **sin tocar `packages/*`**: la vertical agrega una
  vista derivada, un read model y un render; **sin** migración, **sin** UI
  (T24) y **sin** promoción al kernel (D18, ODD #1). Coherente con el corte
  delgado de ADR 0010–0013.
- **Se gana** el cumplimiento de **T7**: la plantilla es **dato versionado**; pasar
  a otra provincia/año (o corregir la forma del formulario) **no** requiere
  release.
- **Se gana** un render **determinista** y testeable **sin navegador** (D4): mismo
  input + mismo reloj ⇒ mismos bytes; ideal para TDD de bordes.
- **Se gana** que la planilla respeta las prohibiciones duras: **vista derivada**
  (T6), alumno por **legajo** (§7.4), **cero** fechas/umbrales hardcodeados
  (§7.8), y **no** integra el sistema provincial (§7.6).
- **Se gana** que `kernel-config` madura con un **consumidor real**: la clave de
  plantilla y su esquema dejan de ser un stub; el mecanismo cumple D19/ADR 0007.
- **Se paga** que `courseId`/`studentId`/`period` son referencias **colgantes**
  hasta que se modelen `Curso`/`Alumno` (F-06) y `Calendario` (F-15); y que la
  **cabecera** no se persiste (viene del pedido): se documenta como limitación del
  corte.
- **Se paga** un **read model cross-agregado** acoplado al esquema de F-01/F-02/
  F-03 (joins por `course_id`): es la forma honesta de una vista derivada sin
  modelo analítico; si F-13/F-16 lo justifican, se revisará.
- **Se paga** que el **render local/offline** (§8 ⚠️) queda diferido: la planilla
  oficial requiere conexión. Asumido y explícito.
- **Fuera de alcance:** UI/`kernel-ui` (T24); `Curso`, `Alumno`, `Matrícula`,
  `Calendario` (F-06/F-15); **Excel/CSV** y el **enlace público** con token (T8/T9);
  el **informe de valoración preliminar** y su envío (§6, F-14); el **libro de
  temas** (§6); el cálculo de **aprobación/intensificación/trayectoria** y sus
  umbrales (T16, F-10/F-12); los **umbrales y ventanas** en `kernel-config`
  (F-10/F-12/F-15); el **render en cliente**; y la **promoción** a
  `kernel-documents`/`kernel-storage` (D18).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| **Modelar `Curso`/`Alumno`/`Matrícula` ahora** | Metería F-06/F-15 en F-04 (`CONTRIBUTING` §7); ODD #1; la vista derivada no los necesita (referencias opacas alcanzan) |
| **Persistir la planilla** (tabla/agregado) | Viola T6/§7.1 ("nunca una tabla editable") y crearía una copia que se desincroniza de sus fuentes |
| **Render en cliente** (PWA) | Rompe el corte delgado servidor+tests (D4), exige UI (T24) y no es testeable sin navegador; el render local se difiere (§8 ⚠️) |
| **Promover `kernel-documents`/`kernel-storage` ahora** | D18/`not-extracted.md` §5: los candidatos se validan con la **segunda** vertical; hoy solo una los pide (ODD #1); cruzaría D15 sin consumidor |
| **Un puerto `DocumentRenderer`** en la vertical | Un puerto con una implementación y un consumidor es **abstracción prematura** (ODD #1, §7); la promoción al kernel introducirá el puerto *entonces* |
| **Plantilla hardcodeada en código** | Viola T7 ("cambiar provincia/año **no** debe requerir release") |
| **Plantilla como JSON Schema / motor de plantillas genérico** | ADR 0007: `kernel-config` no es CMS ni motor de reglas; ODD #1 |
| **Plantilla solo por `kernel-config`, sin default** | La salida no funcionaría *out-of-the-box* (fail-closed total) y obligaría a exponer una superficie de escritura de config fuera de alcance; el default **es un dato** y el override sigue cumpliendo T7 |
| **Librería PDF externa** (`pdf-lib`/`pdfkit`) | Dependencia runtime nueva sin necesidad; un escritor mínimo propio es **determinista** y testeable, sin sumar superficie |
| **Mostrar aprobado/desaprobado** aplicando `≥7` | Requeriría el **umbral** (config sin consumidor, ODD #1) y aplicaría una regla de negocio en una **vista** (T6); §3.5 la ubica en `Intensificación`/`Trayectoria` |
| **Nota con decimales** | La escala/planilla oficial usa **enteros** (T16); el redondeo half-up es la presentación |
| **Cabecera desde `kernel-config` del tenant** | Metería más claves de config sin consumidor (escuela/materia) y se solaparía con `Curso` (F-06); el pedido opaco basta para el corte |
| **`courseId`/`studentId` con clave foránea** | Las tablas `course`/`student` **no existen** (ADR 0010/0013) |
