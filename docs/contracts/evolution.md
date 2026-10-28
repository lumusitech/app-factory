# Contrato de evolución

> Documento normativo. Describe **qué** debe cumplir la evolución del kernel —el
> cambio de esquema (migraciones) y el cambio de versión de un paquete—, no cómo
> implementarla. Cualquier *runner* de migraciones o esquema de versionado que lo
> respete es conforme; el código es una implementación de referencia.
>
> Entregable de la fase 0 ([`docs/kernel-context.md`](../kernel-context.md) §5.4 y
> §7). Elabora las decisiones ya cerradas D2, D13 y D24, y el modelo de despliegue
> de §11.3. Las decisiones **nuevas** que este contrato necesita quedan
> registradas en el [ADR 0004](../adr/0004-decisiones-contrato-evolucion.md); este
> documento las cita y no las duplica.

- **Estado:** propuesto (borrador para revisión de la fase 0)
- **Ámbito:** las **migraciones de esquema** de cada paquete con persistencia y el
  **versionado** de cada paquete del monorepo.
- **Decisiones relacionadas:** §1.2, §4, §5.4, §7, §11.3; D2, D13, D24;
  [ADR 0004](../adr/0004-decisiones-contrato-evolucion.md).

---

## 1. Alcance y precondición

Este contrato gobierna **dos mecanismos distintos** que comparten el mismo
principio —forward-only, nunca hacia atrás— pero operan en planos distintos:

| Mecanismo | Qué evoluciona | Dónde vive |
|---|---|---|
| **Evolución de esquema** | Las tablas, columnas e índices que un paquete posee | `kernel-persistence` y cada vertical con persistencia |
| **Evolución de versión** | El número `"version"` de cada `package.json` | Todo paquete del monorepo (D2, D24) |

Aplica a **todo cambio de esquema** aplicado a un entorno con datos y a **todo
cambio de versión** publicado o consumido por otro paquete. El contrato fija la
**semántica** (propiedad, dirección, procedimiento); **no** fija el *runner*, el
motor de base ni el formato del archivo de migración: eso es implementación
(fase 2).

### 1.1 Qué queda fuera

- **La mecánica del lado servidor ante una mutación repetida** (hash, TTL,
  replay, fail-open): es el [contrato de idempotencia](idempotency.md) (§5.1).
- **El protocolo de la cola offline** (`pending`/`blocked`, transiciones, FIFO,
  conflicto): es el [contrato de sync](sync.md) (§5.2).
- **La forma del alcance y su aplicación** (`ScopeContext`, ALS, RLS): es el
  [contrato de alcance](scope.md) (§5.3).
- **La elección del ORM, del *runner* de migraciones y del motor de base**: es un
  adaptador de salida (§4, D7). El contrato exige el comportamiento, no una
  herramienta.
- **La implementación** de las migraciones concretas y de la política de
  versionado: fase 1 en adelante.

---

## 2. Modelo conceptual

| Término | Significado |
|---|---|
| **Migración** | Un cambio de esquema versionado, aplicado en orden, perteneciente a **un solo** dueño (§3). |
| **Dueño** | El paquete que posee el esquema que la migración modifica y controla su secuencia (§3). |
| **Forward-only** | El esquema solo avanza: no hay *down*, *revert* ni *rollback* de una migración aplicada (§4). |
| **Migración compensatoria** | Una migración **nueva** que corrige hacia adelante el efecto de una anterior (§4). |
| **Inmutabilidad** | Una migración ya aplicada no se edita; su contenido se verifica por *checksum* (§4). |
| **Squash** | Agrupar migraciones **no aplicadas en producción** en una sola, dentro de una **ventana** explícita (§6). |
| **Ventana** | El período durante el cual el squash de un dueño es legítimo; fuera de ella, está prohibido (§6). |
| **Paquete** | Unidad del monorepo con su propio `package.json`; hoy, todo paquete es `private` (D24). |

Todo cambio de esquema pertenece a **exactamente un** dueño; la evolución del
kernel es la suma de las secuencias de sus dueños, no una secuencia global.

---

## 3. Dueño de migraciones por paquete (normativa)

D13 fija el principio: **un dueño por paquete**. Este contrato lo hace operativo:

1. **`kernel-persistence` es dueño del esquema del kernel.** Las tablas del kernel
   (outbox, idempotencia, configuración por tenant, etc.) y sus índices y
   políticas (incluida la RLS de §9 del [contrato de alcance](scope.md)) viven en
   la secuencia de migraciones de `kernel-persistence` (§4).
2. **Cada vertical es dueña de su propio esquema.** Una tabla de dominio de la
   vertical (órdenes, notas, stock, cursos) pertenece a esa vertical, no al
   kernel. El kernel **no** migra tablas de una vertical, ni al revés.
3. **Una migración tiene un solo dueño.** No hay migraciones "compartidas" ni
   cambios que toquen el esquema de dos dueños a la vez. Si un cambio de una
   vertical requiere una tabla nueva **del kernel**, la migración la escribe
   `kernel-persistence` —la vertical no escribe en el esquema ajeno—.
4. **El dueño controla la secuencia completa:** numeración (§5), orden de
   aplicación, inmutabilidad (§4) y ventana de squash (§6). Ninguna otra capa
   decide por él.
5. **Prohibido migrar fuera de la propia propiedad.** Un paquete que aplica una
   migración sobre tablas que no posee es una violación de este contrato, no un
   atajo.

Consecuencia esperada: cada despliegue (D16, §11.3) aplica las migraciones de
**todos** los dueños que lo componen —el kernel y su vertical—, cada una desde su
propia secuencia.

---

## 4. Forward-only (normativa)

El esquema **solo avanza**. Es el corazón de D13 y el remedio directo del
anti-patrón registrado en §1.2 ("`migration:revert` disponible (sin
forward-only)").

- **No hay migraciones *down*.** El contrato **prohíbe** escribir, versionar o
  invocar un *down*, un *revert* o un *rollback* de una migración aplicada. La
  herramienta `migration:revert` es explícitamente **no conforme**.
- **Corregir es avanzar.** Un error se corrige con una **migración
  compensatoria**: una migración nueva que deshace o rehace el efecto de la
  anterior hacia adelante. Nunca se "vuelve atrás" el historial.
- **Inmutabilidad de lo aplicado.** Una migración que ya se aplicó en un entorno
  con datos **no se edita**: su contenido se verifica por ***checksum*** y una
  divergencia entre el archivo y el registro aplicado es un error, no una
  actualización.
- **Sin `*Init` acumulado.** D13 prohíbe acumular llamadas `*Init`. Un dueño
  expone, como máximo, **un** arranque inicial; los cambios posteriores son
  migraciones incrementales, no nuevos `*Init`.
- **El default es avanzar, no revertir.** Ante un despliegue defectuoso, la salida
  es una migración compensatoria hacia adelante (más, si hace falta, el *rollback*
  de la **aplicación**, no del **esquema**). El *runner* concreto queda para la
  fase 2; el contrato fija la dirección.

Diferencia con el *rollback* de la aplicación: revertir un binario es legítimo y
no toca este contrato; revertir **el esquema** está prohibido.

---

## 5. Naming y numeración (normativa)

Para que el monorepo no colisione entre dueños (§3) y el orden sea determinista:

- **Una secuencia por dueño.** Cada dueño tiene su propia numeración monótona;
  dos dueños no comparten contador.
- **Prefijo monótono y ordenable.** El identificador de una migración es único,
  monótono y ordenable dentro de su dueño (por ejemplo, un `NNNN` secuencial o un
  *timestamp*). El formato concreto es de la herramienta (fase 2); el contrato
  exige que sea **único por dueño** y **estable**.
- **Nombre descriptivo legible.** El nombre describe el cambio en
  `kebab-case`, ASCII, sin tildes ni `ñ` (§4 de `CONTRIBUTING.md`), y en **inglés**
  (es código/identificador, no documentación).
- **Sin colisiones en el monorepo.** La combinación dueño + identificador es
  única: el prefijo de dueño desambigua dos secuencias que numéricamente
  coincidan.
- **Orden determinista.** Aplicar la secuencia de un dueño en su orden produce
  siempre el mismo esquema, sin importar el entorno.

---

## 6. Procedimiento de squash (explícito, con ventana)

D13 exige que el squash sea **"un procedimiento explícito con ventana, no un
reflejo"**. Este contrato define ese procedimiento.

### 6.1 Definición

**Squash** es reemplazar **varias migraciones de un mismo dueño** por **una sola**
que produce el **mismo esquema neto**, y reiniciar/reescribir el historial de
migraciones **solo de ese dueño**.

### 6.2 Ventana (elegibilidad)

El squash es legítimo **únicamente** dentro de su ventana. Es elegible si y solo
si, para ese dueño, se cumple **todo** esto:

1. **Ninguna migración del grupo se aplicó en producción.** El esquema del grupo
   solo existió en entornos desechables (local, CI, *staging* sin datos que
   importen).
2. **No hay datos que dependan del historial.** Ningún entorno con datos reales
   aplicó esas migraciones.
3. **El dueño no está publicado.** El paquete del dueño sigue `private` y sin
   consumidor externo (D24, §7).

Fuera de la ventana —una vez que un entorno con datos aplicó alguna migración del
grupo, o el dueño se publicó— el squash de ese grupo está **prohibido**. A partir
de ahí solo quedan migraciones **compensatorias** (§4).

### 6.3 Pasos

1. **Confirmar la ventana** (§6.2) de forma explícita: sin esta confirmación, no
   se squashea.
2. **Preservar el efecto neto.** La migración resultante deja el esquema en el
   **mismo** estado que la secuencia squasheada. Un squash que cambia el esquema
   no es un squash: es un cambio de esquema y lleva su propia migración.
3. **Reiniciar el historial del dueño** (numeración y registro) de forma
   consistente en todos los entornos desechables afectados.
4. **Registrar el evento en el PR**: qué migraciones se agruparon, por qué estaban
   en ventana, y la prueba de que el efecto neto se conserva.

### 6.4 Qué **no** es squash

- **No** es un `revert`: no deshace el esquema hacia atrás (§4).
- **No** es una corrección: corregir un error es una migración compensatoria
  (§4), no un squash.
- **No** es reflejo ni rutina de mantenimiento: es un acto deliberado, se decide y
  se justifica caso por caso (D13).
- **No** cruza dueños: cada squash afecta a **un solo** dueño (§3).

---

## 7. Versionado y disparador de adopción de `changesets` (D24)

Este contrato **no** cambia D2 ni D24: las **elabora** y las hace operativas.

- **`"version"` + `"private": true` desde el día 1.** Todo `package.json` nace con
  ambos (D24). El `package.json` raíz ya lo cumple (`"version": "0.0.0"`,
  `"private": true`).
- **Enlace por workspace, no por rango semver.** El consumo interno se resuelve
  con `workspace:*` (D2): mientras todo sea interno y `private`, los números de
  versión **no gatean nada**.
- **Sin `@changesets/cli` y sin changeset por PR.** No se instala la herramienta
  ni se exige un changeset en cada PR. Los `"version"` se **suben manualmente en
  hitos**, para que no mientan (D24).
- **Disparador de adopción — el primer consumidor externo real.** Se instala
  `changesets` **cuando y solo cuando** aparece el primer consumidor externo que
  necesita un artefacto versionado: un **registry** o un **repo propio** para un
  cliente (D2). Ni antes ni "por si acaso" (ODD #1, §2).
- **El día que se adopta:** se incorpora la herramienta, se documenta el flujo de
  changesets y la publicación, y el versionado pasa a ser automático por changeset
  desde ese punto **hacia adelante**. El historial previo no se reescribe.

Instalar la herramienta antes de ese disparador es ceremonia sin retorno y
contradice ODD #1: **nada entra al kernel sin un consumidor real**.

---

## 8. Frontera con verticales y despliegue (§11.3)

- **El kernel se comparte en repo y build, no en runtime.** Cada producto tiene su
  propio servicio y su propia base (§11.3). Por eso las migraciones del kernel
  (`kernel-persistence`) y las de la vertical se aplican **en el despliegue de esa
  vertical**, cada una desde su secuencia (§3).
- **Un cambio de esquema del kernel reconstruye las verticales.** Desplegar un
  producto no toca a otro; si cambia el kernel, se reconstruyen todos (§11.3). La
  migración del kernel es una sola fuente de verdad aplicada N veces (D1).
- **Poda (ODD #4).** Un paquete sin consumidores se elimina o se degrada a la
  vertical; su secuencia de migraciones se va con él. El contrato no crea
  esquema "por si acaso".
- **Los nombres comerciales se difieren** (§9 de `kernel-context.md`); este
  contrato usa los nombres internos (`teacher-service`, `store-service`,
  `tech-service`) y el de los paquetes del kernel.

---

## 9. Pruebas de conformidad

`kernel-conformance` (§4, fase 3) y el CI deben cubrir, como mínimo, **bordes y
rutas críticas** (D22, `CONTRIBUTING.md` §8): el camino feliz no cuenta.

| Escenario | Qué se verifica |
|---|---|
| Aplicar la secuencia de un dueño | El esquema resultante es determinista e independiente del orden de otros dueños |
| Intentar un `revert`/`down` | **No existe** el comando o está deshabilitado: no hay camino hacia atrás (§4) |
| Migración aplicada, luego editada | El *checksum* no coincide y la aplicación **falla** con un error explícito (§4) |
| Error de esquema | Se corrige con una migración **compensatoria**; el historial no se reescribe (§4) |
| Squash dentro de ventana | Produce el **mismo** esquema neto y el historial del dueño queda consistente (§6) |
| Squash fuera de ventana | Se **rechaza**: hay una migración aplicada en producción o el dueño está publicado (§6) |
| Migración que toca el esquema de otro dueño | Se **rechaza**: viola la propiedad única (§3) |
| Colisión de identificador entre dueños | No ocurre: dueño + identificador es único en el monorepo (§5) |
| Paquete nuevo | Nace con `"version"` y `"private": true`; sin `@changesets/cli` (D24, §7) |
| Cambio de esquema del kernel | Se aplica en cada vertical desplegada; ninguna vertical migra el esquema ajeno (§8) |

---

## 10. Fuera de alcance / "esto no se extrae y por qué"

- **No** se elige el **ORM**, el *runner* de migraciones ni el motor de base: es un
  adaptador de salida (§4, D7), fase 2. El contrato fija la semántica, no la
  herramienta.
- **No** se implementan las migraciones concretas del kernel ni de las verticales:
  son código de fases posteriores.
- **No** se instala `changesets` ni se define su flujo de publicación: se difiere
  al **primer consumidor externo real** (D24, §7). Hacerlo ahora sería
  framework/ceremonia especulativa (ODD #1, §2).
- **No** se define una plataforma de *feature flags* ni de configuración de
  esquema: `kernel-config` (D19) resuelve la configuración **por tenant**, que es
  un problema distinto del esquema.
- **No** se incluye el *rollback* de la **aplicación**: revertir un binario es
  legítimo y ajeno a este contrato; lo prohibido es revertir el **esquema** (§4).
- **No** se re-litiga D13 ni D24: este contrato las cumple y las secuencia.

---

## 11. Referencias

- [`docs/kernel-context.md`](../kernel-context.md) — §1.2 (historial de
  migraciones squasheado, `migration:revert`: anti-patrón), §4
  (`kernel-persistence`), §5.4 (este contrato), §6 (prohibiciones duras, "no
  nuevas migraciones `*Init` sin procedimiento documentado"), §7 (fase 0), §11.3
  (despliegue).
- [`docs/adr/0004-decisiones-contrato-evolucion.md`](../adr/0004-decisiones-contrato-evolucion.md)
  — propiedad de migraciones kernel/vertical, forward-only operativo, naming e
  inmutabilidad, y ventana de squash.
- [`docs/contracts/idempotency.md`](idempotency.md) — §5.1.
- [`docs/contracts/sync.md`](sync.md) — §5.2.
- [`docs/contracts/scope.md`](scope.md) — §5.3; RLS y `tenant_id` viven en el
  esquema del kernel (§3).
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — §3 (commits), §4 (idioma), §7
  (prohibiciones de proceso), §8 (TDD).
- Decisiones: D2, D13, D24; §11.3.
