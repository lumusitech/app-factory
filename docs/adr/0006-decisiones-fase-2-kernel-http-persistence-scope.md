# 0006 — Materialización de `kernel-http`, `kernel-persistence` y `kernel-scope`

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.2, §1.4, §4, §4.1, §5.1, §5.2,
  §5.3, §5.4, §6, §7 (fase 2), §8; D4, D5, D6, D7, D8, D9, D10, D11, D12, D13,
  D15, D19, D22, D23, D24, D25; `docs/contracts/` (los cuatro contratos);
  [ADR 0001](0001-decisiones-contrato-idempotencia.md)–[0005](0005-decisiones-fase-1-kernel-domain-y-contracts.md);
  PR de la fase 2.

## Contexto

La fase 2 (§7) entrega `kernel-http` + `kernel-persistence` + `kernel-scope` con
el criterio de salida: *"un agregado con invariantes persiste, emite outbox y
respeta alcance"*. Es la primera vez que el kernel toca frameworks, un motor de
base y el contexto de ejecución, así que hay que fijar lo que §4/§4.1 y los
contratos nombran pero no deciden.

Cuatro frentes quedaron abiertos y ninguna `D*` los cierra:

1. **El ORM y el *runner* de migraciones.** [ADR 0004](0004-decisiones-contrato-evolucion.md)
   los difirió **explícitamente** a la fase 2 (*"el ORM y el runner de
   migraciones (adaptador de salida, D7, fase 2)"*). El contrato de evolución fija
   la semántica (forward-only, inmutabilidad con *checksum*, ventana de squash),
   no la herramienta.
2. **La frontera de resolución de alcance.** `docs/contracts/scope.md` §8 dejó
   pendiente *"una frontera de importación adicional que impida que otro paquete
   resuelva alcance"* para la **fase 1** (D15), que no se pudo agregar porque
   `kernel-scope` no existía.
3. **El puerto del *store* de idempotencia.** [ADR 0001](0001-decisiones-contrato-idempotencia.md)
   asigna la **implementación del interceptor a la fase 2** y fija la forma del
   registro (`{key, fingerprint, statusCode, body, createdAt, expiresAt}`), pero
   no dónde vive el *seam* entre el borde (que ejecuta) y el adaptador (que
   persiste).
4. **Qué es "un agregado con invariantes" en un kernel sin agregados.** §1.4 lo
   dice y [ADR 0005](0005-decisiones-fase-1-kernel-domain-y-contracts.md) punto 1
   lo confirma: `kernel-domain` nace **sin modelo**. El agregado demostrador no
   puede ser un agregado de vertical.

Además, `kernel-config` (D19) entra *"el día 1"* pero **no está en el árbol de
§4**, y §7 asigna a la fase 2 solo tres paquetes: su secuencia es una decisión
que D19 no resuelve.

Este ADR es el evento explícito de D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y el disparador de [`docs/adr/README.md`](README.md) ("se
introduce … una dependencia, un límite de paquete o un contrato nuevo"). **No
duplica** lo que ya vive en §4/§4.1, en los contratos ni en D1–D25: solo fija lo
que aún no está decidido.

## Decisión

1. **Stack de persistencia: `pg` + SQL explícito, sin ORM.** `kernel-persistence`
   usa el driver `node-postgres` (`pg`) con **SQL escrito a mano** y **mappers
   explícitos** fila ↔ agregado (D7). No se adopta un ORM. Los tests corren
   contra **`@electric-sql/pglite`** (Postgres en WASM, en proceso), de modo que
   los tests son **sin contenedor** (D4) y **con Postgres real** (el backstop RLS
   de D12 es verificable). Alternativas descartadas en la tabla de abajo.
2. ***Runner* de migraciones propio, forward-only con *checksum*.** Las
   migraciones de `kernel-persistence` son **archivos SQL** aplicados por un
   *runner* que: registra en `schema_migrations` `(owner, id, checksum,
   applied_at)`; aplica las pendientes en orden; **falla** si el *checksum* de
   una migración ya aplicada no coincide; y **no expone** API de `down`, `revert`
   ni `rollback` (contrato de evolución §4). Un dueño tiene **un solo** arranque
   inicial (`0001-kernel-schema.sql`); el resto son incrementales. Esto **no**
   cambia D13: la cumple y le da su *runner*.
3. **Adaptadores del kernel.** `IdGenerator` se implementa con **UUIDv7
   generado en el dominio** (D8), sin dependencia de terceros; `Clock` con un
   reloj de sistema inyectable. Ambos viven en `kernel-persistence` (adaptadores
   de salida, D7).
4. **`kernel-scope` es el único seam de alcance, con frontera propia.** La
   resolución de alcance (el `ScopeContext`, el ALS, el accessor fail-closed)
   vive **solo** en `kernel-scope`; el borde **puebla**, el repositorio **aplica**
   (contrato de alcance §4–§6). Se agrega la regla de frontera pendiente de
   `scope.md` §8: **prohibido importar `async_hooks` fuera de
   `packages/kernel-scope/`**, que hace estructural la imposibilidad de resolver
   alcance en otro paquete (D11/D15). `kernel-scope` es TypeScript con **solo
   core de Node** (`node:async_hooks`), sin frameworks.
5. **El puerto del *store* de idempotencia vive en `@kernel/contracts`.** Se
   añaden `IdempotencyRecord` (la forma del registro de `idempotency.md` §4) e
   `IdempotencyStore` (el *seam* entre el borde y el adaptador). Es una
   **ampliación explícita** del alcance de `kernel-contracts` (ADR 0005 lo acotó
   a "envelope, headers, códigos y schemas de protocolo"): se admite porque hay
   **consumidor real** (ODD #1), el paquete sigue **sin dependencias** y es el
   único punto compartido por el borde y el adaptador sin invertir la dependencia
   `persistence → http` ni crear un ciclo. No incluye tipos de entidad (§8): el
   registro no es un agregado.
6. **Alcance de la fase 2 en `kernel-http`.** Se implementan: composition root
   manual, envelope (`Envelope`/`ErrorEnvelope`), filtro de errores que mapea al
   catálogo `ERROR_CODES`/`ERROR_STATUS`, pipeline **Zod → JSON Schema → OpenAPI**
   (`fastify-type-provider-zod` + `@fastify/swagger`), middleware de alcance
   (puebla el ALS desde un resolver de identidad inyectado) y el **interceptor de
   idempotencia** que ADR 0001 asigna a la fase 2 (hash `SHA-256(userId|method|path|key)`,
   TTL 48 h, replay verbatim sin re-ejecución, `409` por concurrencia y por reuso,
   **fail-open** si el store falla, bypass `X-Connectivity-Probe` solo en probe).
   La concurrencia (§6) se detecta **por proceso**: ADR 0001 descartó un estado
   `pending` durable, así que dos instancias distintas caen en la ventana
   *at-most-once* ya documentada por ese ADR.
   **Fuera de la fase 2:** la **detección y la señal de conflicto de sync** y la
   cola/flush, que se difieren a la fase 3 — el *token de versión* es decisión del
   modelo de datos de la vertical (ADR 0002, consecuencias), que disparará su
   propio ADR.
7. **El criterio de salida se prueba con un agregado de referencia de test.** El
   kernel **no** gana un agregado propio (§1.4; ADR 0005 punto 1). Un **agregado
   de referencia** —con invariantes, puerto por agregado (D6), mapper y
   repositorio PGlite— vive **en los tests** (no se exporta, no es un paquete) y
   se ejercita con `fastify.inject()` extremo a extremo: persiste, escribe outbox
   en la misma transacción y respeta alcance (con alcance devuelve solo el tenant
   del `ScopeContext`; sin alcance **lanza** `ScopeMissingError`). Es el mismo
   patrón que `kernel-conformance` reusará en la fase 3.
8. **`kernel-config` (D19) va en su propio PR, inmediatamente después (fase 2b).**
   No entra en este PR: §4 no lo pone en el árbol, §7 asigna la fase 2 a tres
   paquetes y `CONTRIBUTING.md` §7 prohíbe *"abrir un PR con dos features"*. Se
   **respeta el sentido de D19** ("no esperar a la segunda vertical"): su primer
   consumidor es `teacher-service` (fase 5), y adelantar su paquete en un PR
   propio (fase 2b) evita que una vertical invente su mecanismo de configuración.
   D19 no se difiere; se **secuencia**.

## Consecuencias

- **Se gana** la fase 2 materializada: el kernel pasa de "carpeta de contratos" a
  una mecánica que **persiste un agregado con invariantes, emite outbox en la
  misma transacción y hace imposible omitir el alcance** de forma estructural
  (sin API que lo omita) con RLS como red de seguridad.
- **Se gana** el remedio exacto del anti-patrón auditado (§1.2): el ORM **no** es
  el modelo, el ID **no** lo genera la base, y el esquema avanza **forward-only
  con checksum**, no con `migration:revert`.
- **Se gana** una frontera **probada** (regla de dependency-cruiser + self-test):
  ningún otro paquete puede resolver alcance, y `kernel-domain`/`kernel-contracts`
  siguen sin frameworks.
- **Se gana** tests **sin contenedor** con Postgres real (D4 + D12 a la vez), lo
  que permite verificar el backstop RLS temprano en lugar de diferirlo.
- **Se paga** que `kernel-persistence` escribe **SQL y mappers a mano** (sin
  tipado automático de filas ni diffs de DDL). Es el costo que D7 ya da por
  pagado; se acepta a cambio de la separación estricta entidad/agregado y de la
  superficie de dependencias mínima (ODD #1, §2).
- **Se paga** que el *runner* de migraciones es código propio que hay que
  mantener y testear; se acepta porque es lo que hace verificable D13.
- **Se paga** que `@kernel/contracts` crece con un *seam* que no es transporte
  puro. Se documenta el motivo y el disparador (consumidor real, sin deps, sin
  ciclo); si en el futuro otro *seam* pide lo mismo, se evalúa un paquete de
  contratos aparte, no se sigue ensanchando por reflejo.
- **Se paga** que la detección de conflicto de sync queda **sin implementar**
  hasta la fase 3; queda explícito y no es una carencia silenciosa.
- **Se paga** que la concurrencia de idempotencia se detecta **por proceso**: con
  varias instancias, dos requests concurrentes con la misma clave pueden ejecutar
  ambas y caer en la ventana *at-most-once* de ADR 0001. La alternativa (un
  `pending` durable) fue descartada por ese ADR y no se re-litiga.
- **Fuera de alcance:** `kernel-config` (fase 2b; D19), `kernel-client` y
  `kernel-conformance` (fase 3), la cola/flush y el conflicto de sync (fase 3),
  la autenticación y la emisión del token público (contratos aparte), el
  catálogo de roles/permisos (vertical, §1.4), y el *rollback* de la aplicación.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| **TypeORM** como ORM del kernel | Es **el anti-patrón auditado** (§1.2: "Entidad ORM == modelo de dominio — TypeORM es dueño del agregado"; `not-extracted.md` §4). Su `@PrimaryGeneratedColumn` es el **ID de base** que D8 prohíbe; genera `up`**+`down`** (no forward-only, §4) y **no verifica checksum**; el historial `*Init` acumulado de `tech-service` es su resultado |
| **Prisma** como ORM del kernel | **Rompe D4**: no existe `@prisma/adapter-pglite` (verificado: 404 en el registry) → los tests exigirían contenedor, y SQLite perdería el backstop RLS (D12). Además mete `schema.prisma` + codegen como **segunda fuente de verdad** frente a Zod→OpenAPI (riesgo "contrato duplicado", §8), y su canal `latest` hoy es un *release candidate* |
| **Drizzle ORM** | Es la alternativa **razonable** a `pg`+SQL (tiene driver PGlite de primera clase y SQL plano), pero su journal **no verifica checksum**, así que el *runner* propio se necesita igual; suma un DSL y dos dependencias donde el mínimo alcanza (ODD #1). **Es una decisión barata de revertir**: al ser los repositorios puertos por agregado (D6) y el ORM un adaptador (D7), adoptarlo luego toca solo `kernel-persistence` y los adaptadores de vertical |
| Un ORM que "resuelva también RLS y migraciones" | Ninguno integra RLS/`SET LOCAL` de Postgres; en todos se termina escribiendo **SQL crudo** para el backstop D12. Pagar el ORM completo por una parte no ahorra la parte crítica |
| Exigir un contenedor de Postgres en CI | Contradice **D4** ("tests sin contenedor", `fastify.inject()`); PGlite da Postgres real en proceso |
| Meter un agregado de kernel (p. ej. `ConfigEntry`) para cumplir el criterio | Un agregado del kernel solo se admite con la **segunda instancia** (ODD #3, ADR 0005 punto 2). El agregado de referencia en tests prueba la mecánica **sin** admitir nada; `kernel-config` (D19, ya justificado por las tres verticales) va en su propio PR |
| Poner el puerto del store de idempotencia en `kernel-http` | Invertiría la dependencia (`kernel-persistence → kernel-http`) y crearía un ciclo dev con el test de extremo a extremo; `@kernel/contracts` es el punto compartido sin ciclo y sin dependencias |
| Dejar la frontera de alcance para más adelante | `scope.md` §8 la pidió para D15 y es imposible de omitir solo si es **estructural**; sin la regla, cualquier paquete podría re-resolver alcance y volver al anti-patrón opt-in de §1.2 |
| Incluir `kernel-config` en este PR | `CONTRIBUTING.md` §7 prohíbe dos features por PR; su semántica (configuración por tenant, esquema versionado) es un frente propio que merece su revisión |