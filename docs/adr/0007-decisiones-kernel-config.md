# 0007 — Materialización de `kernel-config` (`@kernel/config`)

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.4, §4, §4.1, §5.3, §6, §7, §8;
  D5, D6, D7, D9, D10, D11, D12, D13, D19, D22, D23, D25;
  [ADR 0002](0002-decisiones-contrato-sync.md),
  [ADR 0004](0004-decisiones-contrato-evolucion.md),
  [ADR 0006](0006-decisiones-fase-2-kernel-http-persistence-scope.md);
  `docs/contracts/not-extracted.md`, `docs/contracts/scope.md`,
  `docs/contracts/evolution.md`; PR de la fase 2b.

## Contexto

D19 promueve `kernel-config` **el día 1** —el único candidato de D18 sin esperar
a la segunda vertical— porque las tres verticales necesitan configuración por
tenant con la misma semántica (calendario, umbrales, plantillas, catálogos,
flags). Su alcance mínimo está fijado: *"almacén clave-valor por tenant con
esquema versionado y validación. No es un CMS ni un motor de reglas."*

[ADR 0006](0006-decisiones-fase-2-kernel-http-persistence-scope.md) secuenció
`kernel-config` a **su propio PR (fase 2b)**: §4 no lo pone en el árbol de
paquetes y §7 asigna la fase 2 a tres paquetes, así que adelantarlo en un PR
propio respeta `CONTRIBUTING.md` §7 sin diferir D19.

Al materializarlo aparecen puntos que ninguna `D*` resuelve:

1. **Dónde vive.** §4 no lo lista; puede ser paquete propio, o parte de
   `kernel-domain` (que ADR 0005 dejó sin modelo) o de `kernel-persistence` (que
   es adaptador, D7).
2. **Quién valida.** D19 pide "esquema versionado y validación" pero prohíbe un
   motor de reglas: hay que decidir si el kernel embebe un validador de esquema o
   expone el *seam* y deja el catálogo en la vertical (§1.4: las plantillas son
   datos de la vertical).
3. **La superficie HTTP**: si el kernel ofrece una API de configuración lista o
   solo la mecánica.
4. **El esquema y la frontera**: quién posee la tabla (D13/ADR 0004) y qué reglas
   de importación impiden que el paquete se acople a los adaptadores (D15).

Este ADR es el evento explícito de D23.2. **No duplica** lo que ya vive en
§4/§4.1 ni en D*: solo fija lo que aún no está decidido.

## Decisión

1. **Paquete propio `@kernel/config`.** El agregado, sus invariantes y sus
   puertos son **dominio** (no caben en `kernel-domain`, que ADR 0005 dejó sin
   modelo, ni en `kernel-persistence`, que es adaptador de salida por D7). Es el
   agregado de kernel que D19 admite **porque las tres verticales lo necesitan**
   (no por generalizar con n=1, ODD #3).
2. **Modelo: entrada clave-valor por tenant con esquema versionado.**
   `ConfigEntry = { tenantId, key, value, schemaVersion, updatedAt }`, con:
   clave **registrada** en el catálogo, valor **válido** contra el esquema vigente,
   `schemaVersion` **estampado** por el catálogo (no lo elige el llamador) y
   **sin evento** cuando el valor no cambia. La clave es opaca y namespaced
   (`calendar.term`, `grading.thresholds`), no un identificador adivinable.
3. **La validación es un puerto; el catálogo es de la vertical.** El kernel expone
   `ConfigSchemaRegistry { currentVersion(key); isValid(key, schemaVersion, value) }`
   y la vertical aporta las claves y sus esquemas. **Fail-closed**: clave no
   registrada o valor inválido ⇒ error. El kernel **no** embebe un validador de
   JSON Schema ni un motor de reglas: eso sería framework especulativo (§2) y
   contradiría "no es un motor de reglas" (D19). Los esquemas son **datos de la
   vertical** (§1.4).
4. **Alcance: el tenant sale del `ScopeContext`.** El caso de uso lo obtiene con
   `requireScope()` (fail-closed) y **no** lo recibe del llamador; el puerto de
   dominio no recibe el scope (§4.1, D11). El adaptador aplica el predicado de
   tenant y la **RLS** es el backstop (D12).
5. **`kernel-persistence` sigue siendo el dueño del esquema del kernel.** Se
   agrega una migración **incremental** `0002-config-entry.sql` (nunca un `*Init`;
   ADR 0004 §1/D13) con la tabla `config_entry` y su política de RLS, más el
   `PgConfigEntryRepository` con **mapper explícito** (D7).
6. **Eventos por outbox** (D9/D10): `config.entry.created` y
   `config.entry.updated`, escritos en la **misma transacción** que la entrada.
7. **Sin superficie HTTP en el kernel.** `kernel-config` no expone rutas: la
   vertical registra `GET`/`PUT` sobre el plumbing que ya da `kernel-http`
   (envelope, errores, alcance, idempotencia). Razón: ODD #1 (todavía no hay
   consumidor real) y no acoplar el borde a una capacidad concreta; la forma de la
   API es una decisión del producto.
8. **Fronteras (D15).** `kernel-config` se comporta como `kernel-domain` /
   `kernel-contracts` / `kernel-scope`: **sin frameworks** en runtime (solo
   `local`/`core`) y **sin importar adaptadores** (`kernel-http`,
   `kernel-persistence`). Ambas reglas se agregan al gate con fixtures y
   self-test.
9. **No se pre-diseña el token de versión de sync** (ADR 0002 §4): `ConfigEntry`
   expone `schemaVersion` (el requisito de D19) pero **no** un token monótono de
   escritura. La resolución de conflictos es del contrato de sync, no de config
   (ODD #3).

## Consecuencias

- **Se gana** configuración por tenant con validación **inescapable** (no hay
  forma de construir una entrada sin clave registrada y valor válido), aislamiento
  real (predicado + RLS) y trazabilidad (evento en el outbox).
- **Se gana** que el catálogo de claves y esquemas quede donde corresponde: en la
  vertical (§1.4), sin convertir el kernel en un CMS ni en un motor de reglas.
- **Se gana** que la capacidad sea reutilizable por las tres verticales con
  idéntica semántica, sin inventar un mecanismo por producto (la razón de D19).
- **Se paga** un paquete más y que cada vertical implemente su
  `ConfigSchemaRegistry` **una vez** (su catálogo). Es el trabajo que D19 acepta a
  cambio de no unificar mecanismos después.
- **Se paga** una migración incremental en `kernel-persistence` en lugar de una
  tabla "dentro del paquete nuevo": el esquema del kernel sigue teniendo un solo
  dueño (ADR 0004 §1).
- **Fuera de alcance:** la API HTTP y su forma (vertical); el catálogo de claves y
  esquemas (vertical); la **migración automática** de valores entre versiones de
  esquema (cada vertical decide cómo migrar un valor viejo); el token de versión de
  sync (ADR 0002); un CMS o un motor de reglas (D19); la entrega a otros
  dispositivos.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Embeber un validador de JSON Schema (p. ej. `ajv`) en el kernel | Convierte a D19 en un motor de reglas (lo que prohíbe) y suma una dependencia de runtime a un paquete de dominio; los esquemas son datos de la vertical (§1.4) |
| Validar con Zod dentro de `kernel-config` | Zod es un framework de validación: rompe el espíritu de D5 (ningún framework en el dominio) y ata el catálogo de esquemas al kernel |
| Meter lo agregados/VOs en `kernel-domain` | ADR 0005, punto 1: `kernel-domain` nace **sin modelo**; admitir el agregado ahí contradice esa decisión |
| Poner `kernel-config` dentro de `kernel-persistence` | El agregado y su puerto son dominio; el ORM es adaptador (D7). Además acoplaría la tabla de config a la fase de persistencia |
| Exponer una API de config lista en `kernel-http` | Acopla el borde a una capacidad concreta y agrega superficie sin consumidor real (ODD #1); la forma de la API es del producto |
| Un paquete `kernel-config-http` | "Por si acaso": un paquete para una ruta que ningún consumidor pidió (§2, `CONTRIBUTING.md` §7) |
| Agregar un `version` monótono (token de sync) a `ConfigEntry` | Pre-diseñaría el token que ADR 0002 §4 deja explícitamente a la vertical (ODD #3); config expone solo lo que D19 pide (`schemaVersion`) |
| Guardar el esquema junto al valor en la misma tabla | Duplicaría el catálogo por tenant y lo haría evolucionar N veces (D1); el esquema es de la vertical, no del kernel |
| Migrar automáticamente los valores al subir de versión de esquema | Es una política de la vertical: el kernel **detecta** (leyendo `schemaVersion`) y la vertical decide (§5.2: el kernel no mergea) |