# 0009 — Materialización de `tools/create-vertical` (fase 4)

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §3 (D1, D2, D3, D15, D20, D22,
  D23, D24), §4, §6, §7 (fase 4); `CONTRIBUTING.md` §5, §7, §8;
  [ADR 0005](0005-decisiones-fase-1-kernel-domain-y-contracts.md)–[0008](0008-materializacion-kernel-client-y-conformance.md);
  PR de la fase 4.

## Contexto

La fase 4 (§7) entrega `tools/create-vertical` con un criterio de salida nítido:
*"Genera una vertical cableada y con tests verdes"*. D3 lo define —*"un generador
que crea una vertical **dentro** del monorepo, ya cableada a sync, scope y
tests"*— y D20 lo declara disponible: *"la fase 4 no se difiere; se usa desde la
primera vertical"*.

**Punto a reconciliar (§0).** D20, §4, §7, `CONTRIBUTING.md` §5 y el README
afirman que `tools/create-vertical` está **implementado**; el árbol solo contiene
`tools/boundary-rules/`. Por §0 (*"si algo contradice al código, el código gana y
este documento se corrige"*) la afirmación es **inexacta** y la fase 4 es
**trabajo pendiente**. Este ADR **no re-litiga** D3/D20: los materializa.

Al materializarla aparecen puntos que ninguna `D*` resuelve y la fase necesita
cerrar:

1. **La forma del generador**: lenguaje, estructura, dependencias e invocación.
2. **El contenido de la vertical generada**, y sobre todo qué **no** trae (para
   no inventar dominio: §2, ODD #1).
3. **Cómo se prueba** *"cableada y con tests verdes"* sin contenedor (D4) y sin
   un producto real.
4. **La cobertura de verificación**: los scripts raíz filtran solo `./packages/*`
   (así que `apps/*` **no** entra en typecheck/test/build) y el gate de fronteras
   sólo cruzaba el `.js` compilado de `dist/`, no el fuente `.ts`
   (dependency-cruiser 18 no soporta TS 7). Sin ambos arreglos, *"vertical
   cableada"* no queda verificado.
5. **La reconciliación** del estado "implementado".

Restricciones que aplican: D1/D2 (monorepo con paquetes, enlace por workspace),
D15 (fronteras por herramienta), D22 (TDD, bordes), D23 (ODD) y D24
(`"version"` + `private` desde el día 1).

Este ADR es el evento explícito que exige D23.2 y el disparador de
[`docs/adr/README.md`](README.md) ("se introduce … un contrato nuevo" / "un
límite de paquete"). **No duplica** lo que ya vive en §4/§5 ni en D3/D20.

## Decisión

1. **Generador sin dependencias, en `tools/create-vertical/`.** Node ESM
   (`index.mjs`) + plantilla en `templates/vertical/`, **solo core** (mismo
   estilo que `tools/boundary-rules/`). Se invoca con `pnpm create-vertical
   <name>` (script raíz) o `node tools/create-vertical/index.mjs <name>`. Valida
   el nombre con `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (kebab-case ASCII, sin guiones al
   borde ni duplicados) y **rechaza** un destino existente: no sobre-escribe.
2. **La vertical generada es `apps/<name>/`, cableada al kernel, sin dominio.**
   Trae: `package.json` (`@app/<name>`, `private`, `"version"`, `type: module`,
   deps `@kernel/*` por `workspace:*`), `tsconfig.json` + `tsconfig.build.json`
   (patrón del kernel), **composition root** sobre `buildServer` (`@kernel/http`:
   envelope, errores, alcance, **idempotencia**), un **resolver de identidad
   placeholder** (`SessionResolver`), un `ConfigSchemaRegistry` **vacío**
   (fail-closed, `@kernel/config`), `runAppMigrations` (migraciones del kernel +
   propias), `migrations/` con README, y tests de **smoke + bordes** (probe sin
   alcance; alcance fail-closed; migraciones aplicadas).
3. **Lo que la vertical NO trae (deliberado).** **Sin UI** (`kernel-ui` aparece
   cuando la primera pantalla la consuma), **sin agregado de dominio** (son de la
   vertical, `not-extracted.md` §3) y **sin migración placeholder** "por si
   acaso". El generador produce **cableado**, no modelo.
4. **Verificación en dos capas (D22).** (a) `self-test.mjs` (node:test, sin
   deps) sobre el generador: árbol esperado, sustitución del nombre, rechazo de
   nombres inválidos **y** de un destino existente (bordes, no solo el camino
   feliz). (b) Un job de CI **genera una vertical scratch, instala, corre
   `typecheck` + `test` y `boundary:check`** sobre ella: materializa *"tests
   verdes"*.
5. **Cobertura de CI para `apps/*`.** Los scripts raíz `build`/`typecheck`/`test`
   pasan a filtrar `packages/*` **y** `apps/*`; `prepare` sigue solo `packages/*`
   (construye el `dist` que las verticales resuelven). El generador **no** edita
   los scripts raíz: su salida queda gateada por el filtro.
6. **Fronteras (D15): el gate ahora escanea TypeScript.** No se agrega una regla
   nueva, pero se **repara** el gate: `dependency-cruiser` 18 no soporta TS 7 (su
   transpiler de TS exige `>=2 <7`), así que sin `parser: 'swc'` sólo cruzaba el
   `.js` de `dist/` y las reglas D15 **no** se aplicaban al fuente `.ts`. Se
   habilita con `@swc/core` (devDependency de la raíz) y `parser: 'swc'`, se
   excluye `dist/`, y se agrega la fixture `ts-violation` más un caso de
   self-test que **falla** si el escaneo de TS se pierde. Con esto el gate cubre
   de verdad `apps/*` (`no-cross-app-imports`, `kernel-does-not-import-apps`,
   `scope-resolution-only-in-kernel-scope`) y el job de CI lo verifica sobre la
   vertical generada.
7. **Reconciliación.** Implementado el generador, las afirmaciones
   "implementado" de D20/§4/§7/`CONTRIBUTING` §5/README pasan a ser **ciertas**:
   **no se edita ninguna `D*`**. Se actualiza el **README** (estado y mapa, hoy
   sin la fase 3 ni `kernel-client`/`kernel-conformance`).

## Consecuencias

- **Se gana** la fase 4 materializada y su criterio de salida probado: el
  "monorepo" se vuelve "plantilla" (D3) **sin** caer en un template repo (D1).
- **Se gana** que la primera vertical arranque de tests verdes y de un cableado
  correcto, en lugar de repetir a mano el composition root, el alcance y las
  migraciones (un fix en la plantilla llega a N verticales).
- **Se gana** que `apps/*` quede **gateado** (typecheck/test/build + fronteras),
  brecha que existía y habría dejado a las verticales sin verificación.
- **Se gana** un gate de fronteras que, por primera vez, cubre el **fuente**
  TypeScript y no sólo el `.js` compilado: las reglas D15 se aplican a `src`,
  incluidas las verticales generadas. La degradación silenciosa es imposible: el
  self-test falla si el escaneo de TS se pierde.
- **Se paga** que `tools/create-vertical` es código propio que mantener y
  testear, y que su plantilla es un **contrato vivo**: hay que actualizarla
  cuando cambien las APIs públicas del kernel.
- **Se paga** que la plantilla se escribe **antes** de la primera vertical real
  (fase 5). Se acepta porque sólo cablea **APIs ya implementadas y probadas por
  contratos** y **no** inventa dominio: mitiga el riesgo de generalizar en n=0
  (§2, ODD #3).
- **Fuera de alcance:** `teacher-service` y el **formato del token de versión de
  sync** (fase 5; dispara su **propio ADR**, ADR 0002 §4); `kernel-ui` y el
  cliente offline **en la UI** (aparecen con la primera pantalla); la
  autenticación y la emisión del token público (contratos aparte); cualquier
  generación de UI.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Generar con un **template repo** | Copia código: cada producto nace con una fotografía (lo que D1 descarta explícitamente) |
| Un generador con dependencias (`plop`, `yeoman`, `hygen`) | Añade una dependencia y un DSL para copiar archivos con una sustitución de token; el mínimo alcanza (ODD #1) |
| Scaffolding de **UI/`kernel-ui`** desde ahora | No hay consumidor real de UI (ODD #1); la forma de la primera pantalla es una decisión del producto |
| Incluir un **agregado de dominio de ejemplo** | Inventaría dominio de vertical desde n=0 (§2, ODD #3); la plantilla sólo cablea a un kernel sin modelo (ADR 0005) |
| Una **migración placeholder** "por si acaso" | `evolution.md` §4/§5 y `CONTRIBUTING` §7: nada por anticipado; la primera migración nace con la primera entidad |
| Dejar `apps/*` **fuera** de los scripts raíz | Dejaría a las verticales sin gate de typecheck/test/build; el criterio "tests verdes" no estaría verificado |
| Un self-test que sólo mira el **camino feliz** | D22: el camino feliz no cuenta; el self-test cubre bordes (nombre inválido, destino existente, token sin sustituir) |
| **Derivar el generador de una vertical real** (fase 5 primero) | Difierelo contra D20 ("la fase 4 no se difiere; se usa desde la primera vertical"); la plantilla cablea APIs ya probadas, sin inventar dominio |
| Editar `D20`/§4 para marcar la fase 4 como pendiente | No hace falta: implementar el generador vuelve **ciertas** esas afirmaciones sin tocar ninguna decisión de §3 |
| Enforcar fronteras a nivel fuente con **ESLint `no-restricted-imports`** | D15 lo permite, pero suma ESLint + flat config al PR de la fase 4; se prefiere **reparar** el gate existente (dependency-cruiser) con swc. Queda como alternativa si swc molesta |
| Dejar el gate cruzando sólo el **`.js` compilado** | Es el estado previo: las reglas D15 no se aplican al fuente `.ts` (incluidas las verticales), así que un `import` de framework en `src` evadía el gate |
