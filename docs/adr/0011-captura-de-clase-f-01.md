# 0011 — Captura de clase (F-01): asistencia, tema y tarea offline

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D6, D7, D8, D9, D10, D11, D12,
  D13, D15, D22, D23, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §2 (T4, T10, T11, T12, T24, T25), §3.1, §3.4, §4 (F-01), §7, §8;
  `docs/contracts/sync.md` §8, `docs/contracts/idempotency.md` §1,
  `docs/contracts/scope.md` §9, `docs/contracts/evolution.md` §3–§5;
  [ADR 0002](0002-decisiones-contrato-sync.md),
  [ADR 0008](0008-materializacion-kernel-client-y-conformance.md),
  [ADR 0010](0010-token-version-sync-teacher-service.md);
  PR de F-01.

## Contexto

La fase 5 (§7) entrega `teacher-service` delgado con el criterio de salida
*"converge"*. El corte ya mergeado cubrió la entidad `Clase`
(`ClassSession`, ADR 0010) y su **captura offline** con convergencia (Slice B).
F-01 (`docs/teacher-service-context.md` §4) pide la **captura de clase completa**:
*asistencia + tema del día + tarea, offline, por teclado*. Faltan las tres piezas
restantes.

§3.1 ya nombra dos de ellas: `Clase → Asistencia (alumno, estado)` y
`Curso → Tema (orden en el plan, contenido)`. La **tarea** (la consigna del día)
**no** está en §3.1. Al materializar F-01 aparecen puntos que ni §3 ni las `D*`/
`T*` cierran:

1. **Qué alcance de modelo entra.** §4 v1 dice *"el modelo de §3 se implementa
   completo en v1"*, pero ADR 0010 fijó un **corte delgado** (una entidad,
   `courseId` opaco). Modelar todo §3 (Curso, Alumno, Matrícula, Evaluación,
   Nota, Calendario) contradice ODD #1 y el corte.
2. **Cómo referencian `Curso` y `Alumno`.** `courseId` es opaco (ADR 0010);
   `Alumno`/`Matrícula` **no existen** (su feature es F-06). La asistencia
   necesita referir un alumno sin esa entidad.
3. **Identidad del alumno.** T4 pide legajo interno (DNI opcional); §7.4 prohíbe
   identificar por **posición en la lista**.
4. **El "tema del día".** §7.2/§7.3 prohíben guardar **fechas** en el plan y
   editar la fecha del tema al cancelar: el cronograma se **deriva**. Hay que
   fijar cómo se registra el tema y su relación con la clase.
5. **Cómo se ata la tarea**, que no está en §3.1.
6. **La forma de la asistencia**: §3.1 la dibuja como `Clase → Asistencia
   (alumno, estado)`, pero el ritual de aula (§1.3: *"cargar 30 notas y una
   asistencia"*) es **un acto por clase**.
7. **Los estados de asistencia.** §3.4 enumera estados de `Clase`, `Matrícula`,
   `Intensificación` y `Valoración`, pero **no** de `Asistencia`.
8. **La generación del id de un tema capturado offline.** Para vincular un tema
   recién creado (aún sin sincronizar) el cliente necesita conocer su id.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y `CONTRIBUTING.md` §6 ("si toqué el modelo de datos, paré y
propuse un ADR antes de escribir código"). **No duplica** lo que ya vive en §3.1/
§3.4 ni en D6–D13: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para F-01.

1. **Alcance: el subconjunto de §3 que F-01 exige.** Entran cuatro entidades:
   `Topic` (Tema), `ClassTopic` (vínculo Clase↔Tema = "tema del día"),
   `Assignment` (Tarea) y `ClassAttendance` (agregado de asistencia por clase).
   `Curso`, `Alumno`, `Matrícula`, `Evaluación`, `Nota` y `Calendario` **no** se
   modelan todavía: se difieren a sus features (F-02, F-06). §4 v1 ("§3 completo")
   se satisface **incrementalmente feature por feature**, coherente con el corte
   delgado que ADR 0010 ya estableció.
2. **Referencias opacas.** `courseId` es opaco (ADR 0010) y `studentId` es el
   **legajo interno** (T4): un identificador **estable**, **nunca** la posición en
   la lista (§7.4). Sin clave foránea, porque las tablas `course`/`student` no
   existen todavía. Se documenta como limitación del corte, no como olvido.
3. **`Topic` (Tema)** — `{ id, tenantId, courseId, order, content, version }`.
   **Sin fechas** (§7.2/§7.3: el cronograma se deriva). `order` es un entero ≥ 1;
   `content` no vacío. Se crea offline (`POST /courses/:courseId/topics`).
   **El `id` es opcional y lo puede aportar el cliente (UUIDv7, D8)**: es lo que
   permite crear un tema y vincularlo en la **misma** sesión offline, sin esperar
   al flush (el `ClassTopic` referencia un `topicId` que el cliente ya conoce). Sin
   `id`, lo genera el servidor como en `ClassSession`.
4. **`ClassTopic` (tema del día)** — entidad **aparte**, `{ classSessionId,
   tenantId, topicId, version }`, **una por clase**: registra qué `Topic` del plan
   se dictó. `PUT /class-sessions/:id/topic` (fijar/reemplazar) con token
   `baseVersion` y política `lww`. **No** guarda fechas ni mueve el tema al
   cancelar (§7.3/T11): es el registro de lo **dictado**, no del cronograma.
5. **`Assignment` (Tarea)** — `{ id, tenantId, classSessionId, topicId?, content,
   version }`. Se ata a la **Clase** (la consigna *del día*) con `topicId`
   **opcional**. **Varias por clase**: `POST /class-sessions/:id/assignments` crea
   una (`version` 1).
6. **`ClassAttendance` (Asistencia) — agregado por clase.** El agregado es la
   **hoja de la clase**: `{ classSessionId, tenantId, entries: [{ studentId,
   status }], version }`. Se persiste como **filas por (clase, alumno)** (la forma
   de §3.1), pero se captura y guarda **atómica** con `PUT
   /class-sessions/:id/attendance` (un item de cola por clase; §1.3: el ritual es
   un acto). Invariantes: `studentId` **único** dentro de la hoja, `status` del
   enum, `version` ≥ 1. `PUT` reemplaza la hoja completa, con token `baseVersion`
   y política `lww`. La hoja **puede** tener cero entradas (curso sin alumnos,
   §8): es válida y limpia la asistencia de la clase.
7. **Estados de asistencia (se fijan acá; §3.4 no los define):** `presente` ·
   `ausente` · `tarde` · `justificada` · `retirado`. Se actualiza §3.4 del
   documento de producto.
8. **Token y política de conflicto.** Se reusa ADR 0010 sin re-litigar: `version`
   entero **monótono** por entidad/hoja, expuesto como `String(version)` en el
   header **`X-Sync-Base-Version`** (ADR 0008 punto 5), política **`lww`** (T10,
   sync §8.3). Sin `baseVersion`, la operación no versiona y se aplica.
9. **Mecánica del agregado** (citas a decisiones ya cerradas): invariantes en el
   dominio (D6); **puerto por agregado**, nunca `Repository<T>`; **entidad de
   persistencia + mapper explícito** (D7); eventos en el **outbox** dentro de la
   **misma transacción** (`topic.created`, `class-topic.set`, `assignment.created`,
   `attendance.recorded`; D9/D10); **UUIDv7 generado en el dominio** (D8).
10. **Alcance (T1: el tenant es el docente).** Cada tabla lleva `tenant_id` y
    **RLS** (backstop, D12/scope §9); el repositorio aplica el **predicado de
    tenant** desde el `ScopeContext` vía `TransactionContext` —el puerto no recibe
    el alcance (§4.1, D11)—. Tenant **plano** (D25).
11. **Migración propia** de la vertical, `migrations/0002-class-capture.sql`,
    incremental y forward-only (`evolution.md` §3–§5). El kernel **no** migra
    tablas de la vertical, ni al revés.
12. **Actualiza el documento de producto.** §3.1 gana la `Tarea` y el vínculo
    Clase↔Tema; §3.4 gana los estados de `Asistencia`. A diferencia de ADR 0010
    (donde `version` es un artefacto técnico de sync), acá sí es **modelo de
    producto** y debe quedar en §3.

## Consecuencias

- **Se gana** F-01 completo: asistencia, tema del día y tarea capturables
  **offline** con la cola + idempotencia del kernel, convergiendo (fase 5) y
  **sin tocar `packages/*`** — la vertical solo extiende su `OfflinePolicy` y su
  fachada `ClassSessionSync` (D15, ADR 0008).
- **Se gana** un modelo que respeta las prohibiciones duras: el plan de temas
  **sin fechas** (§7.2/§7.3), el tema **no se mueve** al cancelar (§7.3/T11), el
  alumno identificado por **legajo**, no por posición (§7.4).
- **Se gana** la velocidad del ritual (§1.3): la asistencia es **un** acto por
  clase (un item de cola atómico), no N escrituras.
- **Se gana** coherencia con el token de ADR 0010: mismo `version` entero, mismo
  header, misma política `lww`.
- **Se paga** que `Tarea` y el vínculo Clase↔Tema **no** estaban en §3.1: se
  **amplía** el modelo de producto (documentado, no silencioso).
- **Se paga** que `courseId`/`studentId` son referencias **colgantes** hasta que
  se modelen `Curso` (futuro) y `Alumno` (F-06).
- **Se paga** que el `id` opcional del cliente en `Topic` **diverge** de
  `ClassSession` (id server-side): se acepta porque es lo único que habilita
  crear + vincular un tema offline en una sesión (D8 lo permite: el id es del
  dominio, no de la base).
- **Fuera de alcance:** UI/`kernel-ui` (T24); el adaptador IndexedDB; `Curso`,
  `Alumno`, `Matrícula`, `Evaluación`, `Nota`, `Calendario`; la **reprogramación**
  del tema al cancelar (F-08) y el **libro de temas con trazabilidad** (F-09); la
  entrega proactiva cross-device; la edición/borrado de temas y tareas más allá de
  la captura.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Modelar **todo §3** en este PR (Curso, Alumno, Matrícula…) | Contradice ODD #1 y el corte delgado de ADR 0010; mete features de otros `F-xx` en F-01 (`CONTRIBUTING` §7) |
| Asistencia como **fila por (clase, alumno)**, N items de cola | Rompe la velocidad del ritual (§1.3: la asistencia es un acto) y multiplica los items; `lww` por fila no aporta |
| Asistencia como **batch sin agregado** | Pierde invariantes (alumno duplicado, estado inválido) y un token de versión natural |
| Guardar el tema del día como **`topicId` en `ClassSession`** | Modifica el agregado `ClassSession` ya mergeado (ADR 0010) y sus tests; mezcla dos preocupaciones |
| **`Tema` con fechas** | Viola §7.2/§7.3 y T11: el cronograma se **deriva**; editar una fecha a mano está prohibido |
| **Tarea atada solo al `Tema`** | La consigna es *del día*: sin la clase no se sabe cuándo se pidió |
| Estados de asistencia como **texto libre** | Sin invariante; §3.4 no los fija y dejarlos abiertos traslada el problema al borde |
| Modelar **`Alumno`** ahora para la asistencia | Su feature es F-06 (legajo, duplicados); referir opaco por legajo alcanza para F-01 (T4/§7.4) |
| **Id del `Topic` solo server-side** | Impide crear + vincular un tema en la misma sesión offline; obliga a esperar el flush |
| Registrar el tema del día **solo derivado** (no persistido) | El usuario pidió registrar el tema **dictado**; es la base de la trazabilidad de T12 (F-09) |
| Fijar el token/política en el kernel | Prohibido por ADR 0002 §4 y ADR 0008 punto 5 (pre-diseñaría el modelo de la vertical) |
