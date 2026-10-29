# 0010 — Token de versión de sync y modelo de `Clase` en `teacher-service`

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D6, D7, D8, D9, D10, D11, D12,
  D15, D22, D23, D24, D25), §4, §6, §7 (fase 5); `docs/teacher-service-context.md`
  §2 (T1, T10, T11), §3.1, §3.4, §4 (F-01), §7, §8; `docs/contracts/sync.md` §8;
  `docs/contracts/scope.md` §9; `docs/contracts/evolution.md` §3–§5;
  [ADR 0002](0002-decisiones-contrato-sync.md),
  [ADR 0006](0006-decisiones-fase-2-kernel-http-persistence-scope.md),
  [ADR 0008](0008-materializacion-kernel-client-y-conformance.md);
  PR de la fase 5 (Slice A).

## Contexto

La fase 5 (§7) entrega `teacher-service` delgado —*"un curso, una entidad,
offline"*— con el criterio de salida *"converge"*. Este ADR cubre el **Slice A**:
una **entidad de dominio, su persistencia y su alcance**, con tests de dominio y
de borde. La captura offline y la convergencia (el cliente y su cola) son el
**Slice B** y no se deciden acá.

Dos diferimientos del kernel aterrizan en esta vertical:

1. **El formato del token de versión de sync.** `docs/contracts/sync.md` §8.1
   exige un token *"opaco y monótono, por entidad"* y dice que *"elegir el formato
   es decisión de la vertical, con su propio ADR (implica su modelo de datos)"*.
   [ADR 0002](0002-decisiones-contrato-sync.md) §4 lo repite ("este ADR no fija el
   formato") y [ADR 0008](0008-materializacion-kernel-client-y-conformance.md)
   punto 5 lo confirma: el kernel solo compara *strings* y resuelve la política.
2. **La política de conflicto.** `docs/contracts/sync.md` §8.3 fija
   `teacher-service` = **`lww`** (mono-escritor por tenant, T10): la última
   escritura gana **con aviso**, nunca en silencio.

ADR 0006 punto 6 difirió la **detección/señal** de conflicto a la fase 3 y dejó el
*formato* del token a la vertical; ADR 0008 punto 5 materializó la detección
(header `X-Sync-Base-Version`, señal `Envelope.sync`) y volvió a diferir el
formato. `CONTRIBUTING.md` §6 ("si toqué el modelo de datos, paré y propuse un
ADR") hace que ese formato se decida **antes** de escribir el modelo y la tabla.

Al elegir la entidad del corte delgado aparece una decisión más: cuál nodo de
`teacher-service-context.md` §3.1 modela *"una entidad"*. Candidato: **`Clase`**
(§3.1: `fecha, estado, motivo de cancelación`; §3.4: máquina de estados
`dictada · cancelada(motivo) · feriado · sin_clase`). El resto del árbol (`Curso`,
`Alumno`, `Matrícula`, `Nota`, …) es CRUD o pertenece a features posteriores. En
cambio, `Clase` tiene **invariantes y una máquina de estados**: es exactamente
donde D6 exige puerto por agregado.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y el disparador de [`docs/adr/README.md`](README.md)
("se introduce … un contrato nuevo" / "se elige entre alternativas con
consecuencias difíciles de revertir"). **No duplica** lo que ya vive en §3.1/§3.4
del documento de producto ni en D6–D12: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para el Slice A de la fase 5.

1. **Entidad del corte delgado: `Clase`** (identificador de código en inglés:
   `ClassSession`). Es el primer **agregado** de la vertical. Corresponde a un
   **corte de aceptación** de la fase 5 y a un **sub-slice de servidor de F-01**
   (captura de clase); la asistencia, el tema, la tarea y la captura offline no
   entran en este corte. `Curso` **no** se modela todavía: se referencia con un
   `courseId` **opaco** (sin clave foránea, porque la tabla `course` no existe).
   `school-service`/jerarquía no aplican (T14, D25).
2. **Token de versión: entero monótono por entidad.** Cada `Clase` expone un
   `version` entero que **arranca en 1** y se **incrementa en cada mutación
   aplicada** (cambio de estado). Lo genera el **dominio** (D8: el ID y la versión
   no los asigna la base); la tabla lo persiste como
   `version integer NOT NULL CHECK (version >= 1)`. El token es `String(version)`:
   **opaco y monótono** para el kernel (§8.1), que solo compara cadenas.
3. **Exposición opaca y reenvío.** La respuesta HTTP expone `version` (entero) en
   `data`; el cliente lo reenvía como **`String(version)`** en el header
   `X-Sync-Base-Version` (ADR 0008 punto 5). El servidor contrasta con
   `hasVersionConflict` (sync §8.1) y resuelve con `resolveVersionConflict`.
4. **Política `lww`** (sync §8.3, T10). El servidor **aplica** la última escritura
   y devuelve la **señal de sobrescritura** (`Envelope.sync`: `previousVersion`,
   `actor`, `deviceLabel`, `at`). Nunca es silenciosa: la UI advertirá (Slice B).
   Sin `baseVersion` (o vacío) la operación **no versiona** y se aplica.
5. **Modelo y mecánica del agregado** (citas a decisiones ya cerradas):
   invariantes en el dominio (D6); **puerto por agregado**
   `ClassSessionRepository` (`byId`/`save`), nunca `Repository<T>`; **entidad de
   persistencia + mapper explícito** fila↔agregado (D7); eventos de dominio en el
   **outbox** dentro de la **misma transacción** (`class-session.created` y
   `class-session.status-changed`, D9/D10); **UUIDv7** generado en el dominio (D8).
6. **El estado de la clase es mutable** (cualquier→cualquier entre los cuatro
   valores de §3.4). Lo **exige `lww`** (sync §8.3, T10): como la única mutación de
   este corte es el cambio de estado, una escritura obsoleta solo puede aplicarse
   si el servidor admite re-marcar desde un estado no-`dictada`. Los invariantes que
   quedan: `cancelada` ⟺ motivo no vacío; `version` monótona; re-marcar al **mismo**
   estado es **no-op** (ni evento ni incremento de versión). Una máquina estricta
   ("solo desde `dictada`") rompería `lww` y se descarta (ver alternativas).
7. **Alcance** (T1: el tenant es el docente). La tabla `class_session` lleva
   `tenant_id` y **RLS** (backstop, D12/scope §9), y el repositorio aplica el
   **predicado de tenant** desde el `ScopeContext` vía `TransactionContext` —el
   puerto no recibe el alcance (§4.1, D11)—. Tenant **plano** (D25).
8. **Migración propia** de la vertical, `migrations/0001-class-session.sql`, un
   solo dueño (`teacher-service`) y forward-only (`evolution.md` §3–§5). El kernel
   **no** migra tablas de la vertical, ni al revés.
9. **Sin cambio a §3 del documento de producto.** `Clase` y sus estados ya están
   en §3.1/§3.4; el `version` es un artefacto de **concurrencia optimista** que el
   contrato de sync exige, **no** un atributo de negocio, y no modifica el modelo
   de datos del producto. Este ADR **no edita** `teacher-service-context.md` §3.

## Consecuencias

- **Se gana** el token de sync decidido **antes** del modelo/tabla, como exigen
  ADR 0002 §4 y `CONTRIBUTING.md` §6, con un formato **monótono** (estrictamente
  creciente por escritura aplicada) que satisface §8.1 y habilita `lww` sin
  ambigüedad.
- **Se gana** una entidad con **invariantes reales** (estado mutable con la
  consistencia `cancelada` ⟺ motivo y una `version` monótona) que ejercita el
  camino crítico del kernel —agregado, puerto, mapper, outbox, alcance,
  versión— **sin** inventar dominio ni admitir nada al kernel (ODD #1, §2; el
  kernel sigue sin agregados, ADR 0005 punto 1).
- **Se gana** consistencia con el **agregado de referencia** de
  `kernel-conformance`, que ya usa un entero `version` como token opaco: la
  vertical no introduce un formato exótico.
- **Se paga** que `Clase` **depende de `Curso`** sin que `Curso` exista: el
  `courseId` es una referencia opaca hasta que se modele. Se documenta como
  limitación del corte delgado, no como olvido.
- **Se paga** que el `version` es una columna técnica que el producto no pidió en
  §3.1; se acepta porque el contrato de sync la **exige** para detectar la
  escritura obsoleta (§8.1) y porque el formato del token es, por decisión
  explícita, del modelo de la vertical (ADR 0002 §4).
- **Se paga** que la resolución `lww` **pisa** la escritura vigente (con aviso):
  es el comportamiento deseado en mono-escritor (T10) y la razón de que
  `store-service` no use `lww` (sync §8.3).
- **Fuera de alcance:** la captura offline y la convergencia (Slice B, fase 5);
  `Curso` y el resto del modelo de §3; el adaptador IndexedDB; la entrega
  proactiva cross-device; la autenticación real y el token público (contratos
  aparte); `kernel-ui`.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Token por **`updatedAt`** (timestamptz) | No es **estrictamente monótono** (misma milisegura, reloj hacia atrás) y §8.1 pide monotonía; un empate haría que una escritura obsoleta no se detecte |
| Token por **ETag/hash del contenido** | No es **monótono** (un cambio que vuelve a un valor previo colisiona) y acopla el token a la forma del payload; §8.1 pide opaco y monótono |
| Token **global** por tenant (contador de secuencia) | No es *por entidad* como exige §8.1: dos entidades distintas compartirían token y la detección de escritura obsoleta se rompería |
| Formato fijado en el **kernel** | Lo prohíben ADR 0002 §4 y ADR 0008 punto 5 (pre-diseñaría el modelo de la vertical, ODD #3) |
| Política **`blocked`** para `teacher-service` | Contradice T10 y sync §8.3: es mono-escritor; forzaría resolución humana donde no hay conflicto real |
| **`lww` silencioso** (sin señal) | Viola "nunca silenciosa": el docente pisaría una versión más nueva sin enterarse (sync §8.2) |
| Modelar **`Curso`** como la entidad del corte | `Curso` (§3.1) es identidad + atributos, sin máquina de estados: D6 lo deja pragmático (CRUD), no dispara puerto por agregado y no ejercita los invariantes del corte |
| Máquina de estados **estricta** ("solo desde `dictada`") | Rompe `lww` (T10): con el estado como única mutación, una escritura obsoleta partiría de un estado no-`dictada` y no podría aplicarse; la última escritura dejaría de ganar |
| Incluir **`version` en el modelo de producto (§3)** | Es un artefacto de concurrencia del contrato de sync, no un atributo de negocio; el ADR lo registra sin editar §3 |
| Fijar el token como **string en la respuesta** | No aporta: el entero es igualmente opaco y coincide con el agregado de referencia; el cliente lo convierte con `String(version)` |
