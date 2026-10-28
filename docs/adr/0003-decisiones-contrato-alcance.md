# 0003 — Decisiones del contrato de alcance

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.2 ("Scoping de autorización en
  el controller"), §1.3 (tenant plano), §1.4 (identidad + roles), §4
  (`kernel-scope`), §5.3, §8 (ALS); D5, D11, D12, D15, D16, D22, D23, D25;
  `docs/contracts/scope.md`; PR del contrato de alcance (fase 0).

## Contexto

La fase 0 tiene como segundo entregable los contratos de
[`docs/kernel-context.md`](../kernel-context.md) §5. El §5.3 manda el **contrato
de alcance** con un alcance ya fijado: forma del `ScopeContext`, dónde se puebla,
dónde se aplica, y la prueba de que es **imposible de omitir**; incluye el
supuesto explícito de **tenant plano** (D25) y que la **resolución de alcance vive
solo en `kernel-scope`**.

Buena parte de esa semántica **ya está decidida** y no se re-litiga: D11 fija
que el alcance se aplica en una **capa común** —contexto por `AsyncLocalStorage`
poblado en el borde, consumido por el repositorio— con el objetivo "imposible de
olvidar, no opt-in". D12 exige multi-tenancy real: "si hay `tenant_id`, hay RLS
**o** un scoping obligatorio". D16 fija un despliegue por producto con N tenants.
D25 fija el tenant **plano** y que la resolución de alcance vive en el **único
seam** `kernel-scope`. §1.2 registra el anti-patrón a evitar: el scoping escrito
a mano por endpoint, opt-in y fácil de olvidar. §4 asigna `kernel-scope` a "ALS
`ScopeContext` + aplicación obligatoria del alcance". §8 ya eligió ALS sobre
providers request-scoped para no contaminar el grafo.

Al escribir el contrato (§5.3) aparecen **puntos que ninguna decisión `D*`
resuelve del todo**, y que el contrato necesita cerrar para ser implementable:

1. **La postura de enforcement.** D12 ofrece un **"o"** (RLS *o* scoping
   obligatorio) y el contrato necesita una postura concreta.
2. **El comportamiento fail-closed.** Qué ocurre cuando una consulta se ejecuta
   **sin** alcance activo: es el corazón de "imposible de omitir" y hoy no está
   escrito.
3. **El alcance de una request pública por token** (T9, §1.4): el acceso anónimo
   pasa por el borde y llega al repositorio; cómo puebla su alcance no está
   decidido.
4. **El alcance de la aplicación.** Si el alcance cubre solo los agregados con
   invariantes (D6) o **todo** acceso a datos.
5. **La forma normativa del `ScopeContext`.**

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un
evento explícito (ADR)") y el disparador de
[`docs/adr/README.md`](README.md) ("se introduce … un contrato nuevo"). **No
duplica** lo que ya vive en §1.2/§1.3/§5.3 ni en D11/D12/D16/D25: solo fija lo
que aún no está decidido. **No contradice ni matiza** ninguna decisión `D*`:
elabora D11/D12/D16/D25 y cierra sus seams, igual que los ADR
[0001](0001-decisiones-contrato-idempotencia.md) y
[0002](0002-decisiones-contrato-sync.md).

## Decisión

Se adoptan las siguientes resoluciones para el contrato de alcance.

1. **Enforcement: scoping obligatorio (primario) + RLS (backstop).** Se cumple
   D12 sin elegir un solo lado del "o": la **aplicación obligatoria** en el
   repositorio es el mecanismo primario que hace la omisión imposible; **RLS** es
   la defensa en profundidad que atrapa el error de implementación.
2. **Fail-closed.** Si una consulta con datos de tenant se ejecuta **sin**
   `ScopeContext` activo, el accessor de `kernel-scope` **lanza**
   (`ScopeMissingError`) y la consulta **no se ejecuta**. **No** existe un camino
   de la API que omita el alcance: la garantía es estructural, no una convención.
3. **Poblado en el borde, incluido el acceso público.** El `ScopeContext` se
   puebla **una vez** en `kernel-http`, tras resolver la identidad, antes del
   handler. Una request con **token público** (T9) también puebla alcance: su
   `actor.kind = 'public-token'` y su `tenantId` es el que el token define. El
   acceso anónimo **no** queda sin tenant.
4. **Aplicación en el repositorio, vía ALS.** El repositorio concreto
   (`kernel-persistence`) consume el alcance por `AsyncLocalStorage` e inyecta el
   predicado de tenant. El **puerto de dominio no cambia de firma** (§4.1): no
   recibe el scope.
5. **Aplicación universal.** El alcance cubre **todo acceso a datos de tenant**,
   hexagonal o CRUD pragmático. D6 decide *dónde hay puerto hexagonal*, no *dónde
   hay alcance*: un CRUD sin invariantes también está acotado.
6. **Forma normativa del `ScopeContext`.** El tipo vive en `kernel-scope` y es
   mínimo: `tenantId` (plano, obligatorio, opaco) + `actor`
   (`{ kind: 'user', id }` | `{ kind: 'public-token', id }`). **No** transporta el
   catálogo de roles ni permisos: eso es de la vertical (§1.4). El
   `ScopeContext` es **inmutable**; aguas abajo solo se lee.
7. **Resolución solo en `kernel-scope`.** Ninguna otra capa resuelve ni ensancha
   alcance: el borde puebla, el repositorio aplica, ninguno decide. La
   vertical **configura**, no re-implementa (§1.2, D11).
8. **Tenant plano (D25).** Sin `parent_id`, sin resolución recursiva, sin
   permisos por ancestro/descendiente. El supuesto se escribe **explícito** en el
   contrato (§7 de `docs/contracts/scope.md`); un futuro producto jerárquico se
   reevalúa con el test de §2 y, por D16, probablemente sea otro producto.

## Consecuencias

- **Se gana** una omisión **imposible** y no opt-in: no hay API que consulte datos
  de tenant sin alcance, y el default es fail-closed. Es exactamente el objetivo
  de D11, verificado de forma estructural (§6 del contrato).
- **Se gana** aislamiento **real**, no branding: el caso `tech-service` (D12,
  §1.2: "multi-tenant" que solo era theming) queda excluido por diseño —
  scoping obligatorio **y** RLS.
- **Se gana** un acceso público por token **acotado a un tenant** (T9), sin
  introducir anonimato sin alcance.
- **Se paga** que cada tabla con datos de tenant lleva `tenant_id` y política de
  RLS, y que cada repositorio concreto debe consultar el alcance. Es trabajo
  **una vez** en `kernel-persistence`, no en cada vertical (D1).
- **Se paga** que el alcance **no** cubre solo los agregados hexagonales (D6):
  también el CRUD pasa por repositorios acotados. Es deliberado: dejar el CRUD
  fuera abriría una fuga.
- **Fuera de alcance:** el catálogo de roles/permisos (§1.4); la autenticación
  (login social, §11.4) y el formato del token público (T9); el contrato de
  idempotencia (§5.1) y el de sync (§5.2); el catálogo concreto de códigos de
  error (`kernel-contracts`, §4); la implementación de la middleware y de los
  repositorios (fase 2); cualquier frontera de importación adicional (fase 1,
  D15).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Scoping de autorización en el controller (por endpoint) | Es el anti-patrón de §1.2: **opt-in y fácil de olvidar**. El objetivo de D11 es lo contrario |
| RLS como **único** mecanismo | Ataría la garantía al motor de base y dificultaría los tests sin contenedor (D4: Vitest + `fastify.inject()`). El scoping de aplicación da la prueba estructural; RLS queda como backstop |
| Scoping obligatorio **sin** RLS | Descartaría la mitad de D12 y perdería la defensa en profundidad: un defecto en el filtro de aplicación filtraría datos de otro tenant |
| Providers request-scoped (estilo NestJS) | Contamina el grafo de dependencias (§8); D11 y §8 piden explícitamente **ALS** |
| Aplicar alcance solo a agregados con invariantes (D6) | Dejaría el CRUD pragmático sin acotar: una fuga en la parte "sin invariantes" sigue siendo una fuga cross-tenant |
| Accessor que devuelve un scope vacío en vez de lanzar | Sería **fail-open**: una consulta sin alcance filtraría de más o de menos en silencio. El default debe negar |
| Incluir el catálogo de roles/permisos en `kernel-scope` | Lo convertiría en framework especulativo (§2); §1.4 dice que el kernel provee **solo la mecánica** |
| Pre-diseñar jerarquía de tenants (`parent_id`, resolución recursiva) | Prohibido por D25, §2 y ODD #1/#3: ninguna de las tres verticales la necesita. Queda como supuesto explícito, no como diseño |
| Meter el `ScopeContext` como parámetro del puerto de dominio | Cambiaría la firma de §4.1 y pondría el alcance en el dominio; D11 lo asigna al adaptador, vía ALS |
