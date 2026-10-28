# 0004 — Decisiones del contrato de evolución

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.2 ("Historial de migraciones
  squasheado"), §4 (`kernel-persistence`), §5.4, §6 (prohibiciones duras), §7
  (fase 0), §11.3 (despliegue); D2, D13, D24;
  `docs/contracts/evolution.md`; PR del contrato de evolución (fase 0).

## Contexto

La fase 0 tiene como segundo entregable los contratos de
[`docs/kernel-context.md`](../kernel-context.md) §5. El §5.4 manda el **contrato
de evolución** con un alcance ya fijado: **dueño de migraciones por paquete,
forward-only y procedimiento de squash**; e incluye el **disparador de adopción de
`changesets`** (D24).

Buena parte de esa semántica **ya está decidida** y no se re-litiga. D13 fija:
"**Migraciones: forward-only, un dueño por paquete.** Prohibido acumular `*Init`.
Si se hace squash, es un procedimiento explícito con ventana, no un reflejo". D2
fija semver desde el día 1 y **no acoplarse al workspace**; D24 difiere **la
herramienta** (`changesets`) al primer consumidor externo y deja cada
`package.json` con `"version"` y `"private": true`. §4 asigna `kernel-persistence`
a "entidades, mappers, **migraciones**". §1.2 registra el anti-patrón a evitar:
"31 migraciones, 8 llamadas `*Init`; `migration:revert` disponible (sin
forward-only)". §11.3 fija un despliegue por producto con el kernel compartido en
repo y build, no en runtime.

Al escribir el contrato (§5.4) aparecen **puntos que ninguna decisión `D*`
resuelve del todo**, y que el contrato necesita cerrar para ser implementable:

1. **La partición de propiedad kernel ↔ vertical.** D13 dice "un dueño por
   paquete" pero no dice **quién** es dueño de qué cuando un despliegue compone el
   kernel y su vertical.
2. **La forma operativa de forward-only.** "Forward-only" no fija qué reemplaza al
   *revert*, ni si una migración aplicada puede editarse, ni cómo se detecta la
   divergencia.
3. **El contenido y la ventana del squash.** D13 exige "un procedimiento explícito
   con ventana" pero no define **el procedimiento** ni **cuánto dura la ventana**.
4. **Naming y numeración en el monorepo.** Cómo evitar colisiones entre las
   secuencias de dueños distintos.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y el disparador de [`docs/adr/README.md`](README.md) ("se
introduce … un contrato nuevo"). **No duplica** lo que ya vive en §1.2/§5.4 ni en
D2/D13/D24: solo fija lo que aún no está decidido. **No contradice ni matiza**
ninguna decisión `D*`: elabora D2, D13 y D24 y cierra sus *seams*, igual que los
ADR [0001](0001-decisiones-contrato-idempotencia.md),
[0002](0002-decisiones-contrato-sync.md) y
[0003](0003-decisiones-contrato-alcance.md).

## Decisión

Se adoptan las siguientes resoluciones para el contrato de evolución.

1. **Propiedad de migraciones: kernel ↔ vertical.** `kernel-persistence` es dueño
   del esquema del kernel (outbox, idempotencia, configuración por tenant, RLS de
   §9 del contrato de alcance); **cada vertical es dueña de su propio esquema**.
   Una migración tiene **un solo** dueño; ninguna capa migra tablas ajenas. Un
   despliegue (D16) aplica las secuencias de **todos** los dueños que lo componen.
2. **Forward-only operativo.** No hay *down*, *revert* ni *rollback* de una
   migración aplicada (`migration:revert` es **no conforme**). Un error se corrige
   con una **migración compensatoria** hacia adelante. Una migración ya aplicada en
   un entorno con datos es **inmutable** y se verifica por ***checksum***. Se
   mantiene la prohibición de acumular `*Init` (D13). Revertir el **binario** de la
   aplicación es legítimo y queda fuera de este contrato; revertir el **esquema**
   está prohibido.
3. **Naming y numeración.** Una **secuencia monótona por dueño**, con
   identificador único y ordenable; la combinación **dueño + identificador** es
   única en el monorepo, de modo que dos secuencias no colisionan. El nombre es
   legible, `kebab-case` ASCII y en inglés.
4. **Squash: procedimiento explícito con ventana.** El squash agrupa migraciones
   de **un mismo dueño** en una sola que preserva el **efecto neto**. La
   **ventana** es: ninguna migración del grupo se aplicó en producción, no hay
   datos que dependan del historial, y el dueño sigue `private` sin consumidor
   externo. Fuera de la ventana, el squash está **prohibido** y solo quedan
   migraciones compensatorias. El squash es un acto deliberado registrado en el
   PR, nunca un reflejo (D13).
5. **Versionado: se mantiene D24 sin cambios.** Cada `package.json` nace con
   `"version"` y `"private": true`; enlace por `workspace:*` (D2); sin
   `@changesets/cli` ni changeset por PR; subida manual de `"version"` en hitos.
   El **disparador de adopción** de `changesets` es el **primer consumidor externo
   real** (registry o repo propio). Este contrato **no** adelanta ese disparador.

## Consecuencias

- **Se gana** una evolución **reversible en el sentido correcto**: el esquema solo
  avanza, todo cambio queda auditable en una secuencia de migraciones y no hay
  "vuelta atrás" silenciosa. Es exactamente el remedio del anti-patrón de §1.2
  (`migration:revert`, `*Init` acumulado).
- **Se gana** una frontera de propiedad nítida: un cambio de esquema del kernel
  toca `kernel-persistence` **una vez** y se aplica en N despliegues (D1); una
  vertical nunca escribe en el esquema ajeno.
- **Se gana** un squash **gobernado**: posible en el tramo de desarrollo, prohibido
  en cuanto hay datos en producción o el dueño se publica. Deja de ser un reflejo
  accidental (D13).
- **Se gana** coherencia con D24: el `"version"` existe desde el día 1 pero no
  miente, porque no gatea nada mientras todo sea `private` y por `workspace:*`.
- **Se paga** que cada error de esquema requiere una migración compensatoria
  (trabajo explícito) en lugar de un `revert` cómodo; es el precio de la
  auditabilidad y de no depender del *down*.
- **Se paga** que cada dueño mantiene y entiende **su** secuencia, y que el squash
  exige disciplina de ventana; sin ella, el historial se vuelve el problema
  original.
- **Se paga** tener que instalar y cablear `changesets` **el día** que aparece el
  primer consumidor externo; se acepta a cambio de no cargar ceremonia sin
  retorno hoy (ODD #1).
- **Fuera de alcance:** el ORM y el *runner* de migraciones (adaptador de salida,
  D7, fase 2); las migraciones concretas; el flujo de publicación de `changesets`
  (diferido, D24); `kernel-config` (D19) y la configuración por tenant; el
  *rollback* de la aplicación.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Migraciones *down*/*revert* disponibles | Es el anti-patrón de §1.2 y lo que D13 prohíbe; ataría la corrección a un camino hacia atrás no auditable |
| Editar una migración ya aplicada "para arreglarla" | Rompe la inmutabilidad y la reproducibilidad entre entornos; el *checksum* la detecta y el contrato la prohíbe |
| Un único dueño global de migraciones | Concentraría el esquema de todas las verticales en un paquete, acoplando lo que D1/D16 mantienen separado; contradice "un dueño por paquete" (D13) |
| Que la vertical migre el esquema del kernel | Difumina la frontera de §4 y arriesga que un cambio del kernel viva en N verticales; rompe el "un fix, N verticales" (D1) |
| Squash libre, sin ventana | Es el "reflejo" que D13 prohíbe; reescribir el historial con datos en producción pierde auditabilidad |
| Squash prohibido siempre | Descartaría el mecanismo que D13 contempla explícitamente; la ventana existe para poder limpiar el tramo previo a producción |
| Instalar `changesets` en la fase 0 | Ceremonia sin retorno y contra ODD #1; D24 difiere la herramienta hasta el primer consumidor externo |
| Versionado manual indefinido (sin disparador) | Dejaría el versionado semiautomático para siempre; D24 fija el disparador (primer consumidor externo) y este ADR lo respeta |
| Una secuencia global numerada en el monorepo | Provocaría colisiones y acoplamiento de orden entre dueños; la secuencia por dueño (§3) la evita |
