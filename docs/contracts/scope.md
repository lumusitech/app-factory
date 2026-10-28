# Contrato de alcance

> Documento normativo. Describe **qué** debe cumplir la aplicación del alcance
> (usuario/tenant) en el kernel, no cómo implementarla. Cualquier adaptador que lo
> respete es conforme; el código es una implementación de referencia.
>
> Entregable de la fase 0 ([`docs/kernel-context.md`](../kernel-context.md) §5.3 y
> §7). Elabora las decisiones ya cerradas D11, D12, D16 y D25, y el supuesto de
> tenant plano de §1.3. Las decisiones **nuevas** que este contrato necesita
> quedan registradas en el [ADR 0003](../adr/0003-decisiones-contrato-alcance.md);
> este documento las cita y no las duplica.

- **Estado:** propuesto (borrador para revisión de la fase 0)
- **Ámbito:** todo acceso a datos de un tenant —en el borde (`kernel-http`) y en
  el repositorio (`kernel-persistence`)—, con la **resolución de alcance viviendo
  solo en `kernel-scope`**.
- **Decisiones relacionadas:** §1.2, §1.3, §1.4, §4, §5.3, §8; D5, D11, D12,
  D15, D16, D22, D23, D25; [ADR 0003](../adr/0003-decisiones-contrato-alcance.md).

---

## 1. Alcance y precondición

El alcance aplica a **toda request que lea o escriba datos de un tenant**,
autenticada o pública. A diferencia de la idempotencia (§5.1) y del sync (§5.2),
que gobiernan **mutaciones**, este contrato gobierna **todo acceso a datos**:

- **Lecturas** (`GET`, `HEAD`) y **mutaciones** (`POST`, `PUT`, `PATCH`,
  `DELETE`) por igual.
- Ejecutado en el borde (`kernel-http`) y verificado en el repositorio
  (`kernel-persistence`), nunca en el dominio (§6, D11).

Una request entra al mecanismo si y solo si se cumplen **las dos** condiciones:

1. **Resolvió una identidad.** O bien un **usuario autenticado**, o bien un
   **acceso público por token** con alcance definido (T9, §1.4). Sin identidad no
   hay tenant del cual derivar el alcance.
2. **Va a tocar datos de un tenant.** Un endpoint que no consulta datos de
   tenant (p. ej. un *health check* o un *probe* de conectividad) no puebla ni
   consume alcance.

Si falta cualquiera de las dos, la request **no** establece alcance: o es un
endpoint sin datos de tenant (y no aplica), o es una request sin identidad (y no
debe llegar al repositorio, §6).

### 1.1 Qué queda fuera

- **La mecánica del lado servidor ante una mutación repetida** (hash, TTL,
  replay, fail-open): es el [contrato de idempotencia](idempotency.md) (§5.1).
- **El protocolo de la cola offline** (`pending`/`blocked`, transiciones, FIFO,
  watchdog, conflicto): es el [contrato de sync](sync.md) (§5.2).
- **La forma del envelope y los códigos de error concretos**: viven en
  `kernel-contracts` (§4). Acá se referencian, no se redefinen.
- **El catálogo de roles y permisos.** El kernel provee la **mecánica** de
  identidad y alcance; el catálogo es de la vertical (§1.4, §5.3).
- **La autenticación** (login social/Google, §11.4) y la **emisión del token
  público** (T9): son de otros contratos. Acá solo se define cómo su resultado
  (una identidad) se convierte en alcance.
- **La implementación** de la middleware y de los repositorios: fase 2.

---

## 2. Modelo conceptual

| Término | Significado |
|---|---|
| **Tenant** | La unidad de aislamiento. **Plano**: sin jerarquía (§7, D25). |
| **Usuario** | Identidad autenticada (persona) dentro de un tenant. |
| **Token público** | Acceso anónimo, opaco y revocable, con alcance definido (T9). |
| **Actor** | Quien ejecuta la request: un usuario o un token público (§3). |
| **`ScopeContext`** | Estructura inmutable con el alcance de la request: tenant + actor (§3). |
| **Borde** | El punto donde la identidad se resuelve y el alcance se puebla (`kernel-http`, §4). |
| **Aplicación** | La inyección del predicado de tenant en la consulta (`kernel-persistence`, §5). |
| **ALS** | `AsyncLocalStorage`: el mecanismo de propagación del alcance sin contaminar el grafo (§8, D11). |
| **Seam** | El único paquete que resuelve alcance: `kernel-scope` (§8). |

Toda request con datos de tenant **tiene exactamente un** `ScopeContext`, poblado
una vez en el borde y consumido (solo lectura) aguas abajo.

---

## 3. Forma del `ScopeContext` (normativa)

Forma mínima y normativa. El tipo se define en `kernel-scope` (§4) y es lo único
que el kernel expone sobre el alcance:

```ts
// kernel-scope — sin dependencias de framework
interface ScopeContext {
  readonly tenantId: TenantId; // plano (D25); nunca null ni vacío
  readonly actor: Actor;       // siempre presente
}

type Actor =
  | { readonly kind: 'user'; readonly id: UserId }        // usuario autenticado
  | { readonly kind: 'public-token'; readonly id: TokenId }; // acceso por token (T9)
```

Notas normativas:

- **`tenantId` es plano y obligatorio.** Es un identificador opaco; el kernel
  **no interpreta su formato**. No existe un tenant "padre", "hijo" ni
  resolución recursiva (§7, D25).
- **`actor` distingue la procedencia** (usuario vs. token público) pero **no**
  transporta el catálogo de roles ni permisos: eso es de la vertical (§1.4).
- **El `ScopeContext` es inmutable.** Aguas abajo se **lee**, nunca se muta: el
  alcance no se ensancha ni se reemplaza a mitad de request (§8).
- **El puerto de dominio no lo recibe.** Los puertos de §4.1
  (`WorkOrderRepository`, etc.) mantienen su firma sin parámetro de alcance: el
  repositorio **concreto** lo consume por ALS (§5, D11).

---

## 4. Dónde se puebla (el borde)

El alcance se puebla **en el borde**, en `kernel-http` (§4), **una sola vez** por
request:

1. La middleware resuelve la **identidad** —usuario autenticado o token público
   con alcance (T9)—.
2. Con la identidad resuelta, construye el `ScopeContext` de §3.
3. Envuelve el resto del pipeline (handler incluido) en
   `als.run(scope, () => next())`, de modo que toda lectura aguas abajo vea el
   alcance.

Propiedades del poblado:

- **Una vez por request.** No se reescribe ni se "corrige" más abajo; el alcance
  es un dato de entrada, no un estado mutable.
- **Antes del handler.** El repositorio se ejecuta dentro del scope; nunca fuera.
- **Incluye el acceso público.** Una request con token público puebla su
  `ScopeContext` con `actor.kind = 'public-token'` y el `tenantId` que el token
  define (T9): el acceso anónimo **también** está acotado a un tenant.
- **Una request sin identidad no puebla alcance.** No hay un "scope por
  defecto": llegar al repositorio sin alcance es un error explícito (§6).

Este contrato **no** define el mecanismo de autenticación ni el formato del
token; solo exige que su resultado se materialice en el `ScopeContext` en este
punto.

---

## 5. Dónde se aplica (el repositorio, vía ALS)

El alcance se aplica **en el repositorio concreto** (`kernel-persistence`), que lo
consume desde el ALS (§4.1, D11):

- Cada consulta con datos de tenant **inyecta el predicado de tenant** derivado
  del `ScopeContext` (p. ej. `WHERE tenant_id = :scope.tenantId`).
- El **puerto de dominio no cambia de firma**: sigue recibiendo `id`, no scope
  (§4.1). La aplicación del alcance es responsabilidad del adaptador, no de la
  vertical ni del dominio.
- **Punto de aplicación único.** No hay un segundo lugar donde se filtre por
  tenant: ni el controller, ni el guard, ni el dominio (§1.2, §6, D11).

La aplicación **no se limita a los agregados con invariantes** (D6): un CRUD
pragmático también opera sobre datos de tenant y también pasa por el repositorio
acotado. D6 decide *dónde hay puerto hexagonal*, no *dónde hay alcance*.

---

## 6. Prueba de que es imposible de omitir (no opt-in)

El objetivo de D11 es literal: **imposible de olvidar, no opt-in**. La prueba
tiene tres patas.

### 6.1 El anti-patrón que se descarta

§1.2 registra el scoping escrito a mano por endpoint
(`filterDto.technicianId = user.id` en el controller): es **opt-in y fácil de
olvidar**. Este contrato lo **prohíbe**: el alcance no se aplica en el
controller, el guard ni el interceptor (§6 de `kernel-context.md`, "No reglas de
negocio en controllers, guards o interceptors").

### 6.2 Mecanismo: fail-closed estructural

Imposible de omitir significa que **no existe un camino** que consulte datos de
tenant sin alcance:

- El repositorio concreto obtiene el alcance por el **accessor ALS** de
  `kernel-scope`; **no** hay una variante de la API de consulta que lo omita.
- Si no hay `ScopeContext` activo, el accessor **lanza** (`ScopeMissingError`) y
  la consulta **no se ejecuta**. El default es **fail-closed**: ante la duda, se
  niega, no se filtra de más.
- El dominio no conoce el mecanismo: ve el mismo puerto de §4.1. La garantía es
  **estructural** (no hay API que lo omita), no una convención de estilo.

### 6.3 Backstop: RLS (D12)

Como **defensa en profundidad**, y según D12, las tablas con datos de tenant
llevan `tenant_id` y **RLS** que restringe por el tenant de la sesión. Si por un
defecto de implementación una consulta escapara al filtro de la aplicación, la
base **no devuelve filas de otro tenant**. La aplicación obligatoria (§6.2) es el
mecanismo primario; RLS es la red que atrapa el error. Detalle en §9 y en el
[ADR 0003](../adr/0003-decisiones-contrato-alcance.md).

### 6.4 Verificación

La imposibilidad de omitir se **prueba** con los escenarios de §10, ejecutados por
`kernel-conformance` (fase 3): una consulta fuera de alcance **lanza**, y una
lectura cross-tenant **no devuelve** datos ajenos.

---

## 7. Supuesto explícito: tenant plano (D25)

**Supuesto:** el tenant es **plano**. No hay sub-tenants.

Consecuencias normativas:

- **Sin `parent_id`**, sin árbol de tenants, sin **resolución recursiva**.
- **Sin permisos por ancestro/descendiente.**
- La resolución de alcance es una **búsqueda plana** (el tenant de la request),
  no un recorrido.
- Si en el futuro un producto exigiera jerarquía, se **reevalúa con el test de
  §2** —y, por D16, probablemente sea **otro producto** con su propio
  despliegue—. El retrofit toca **un solo seam** (`kernel-scope`), no N
  verticales.

Este supuesto es explícito, no un olvido: pre-diseñar jerarquía está prohibido
por §2 (la intersección, nunca la unión), ODD #1 (nada sin consumidor real) y
ODD #3 (prohibido generalizar con n=1).

---

## 8. Frontera: la resolución de alcance vive SOLO en `kernel-scope`

La **resolución de alcance** —de identidad a `ScopeContext`, y su aplicación—
vive en **un único seam**: `kernel-scope` (§4, §5.3, D11):

- **Ninguna otra capa resuelve ni ensancha alcance.** El borde **puebla** (§4); el
  repositorio **aplica** (§5); ninguno **decide** el alcance por su cuenta.
- **La vertical configura, no re-implementa.** Una vertical aporta su catálogo de
  roles y sus reglas, pero **no** escribe su propio scoping de tenant (§1.2).
- **ALS, no providers request-scoped.** El contexto viaja por
  `AsyncLocalStorage`, no por un provider de request-scope que contamine el
  grafo de dependencias (§8 de `kernel-context.md`, D11).
- **Un fix, N verticales.** Un cambio en la resolución de alcance toca
  `kernel-scope`, no cada producto (D1).

Si algún día hace falta una frontera de importación adicional que impida que otro
paquete resuelva alcance, es una decisión de la **fase 1** (D15), no de este
contrato.

---

## 9. RLS y defensa en profundidad (D12)

D12 exige que, si hay `tenant_id`, haya **RLS** o un **scoping obligatorio**. Este
contrato adopta **ambos, con roles distintos**:

| Mecanismo | Rol | Dónde |
|---|---|---|
| **Scoping obligatorio (fail-closed)** | **Primario.** Hace la omisión imposible (§6.2). | `kernel-persistence` + `kernel-scope` |
| **RLS** | **Backstop.** Atrapa el error de implementación si el filtro de la aplicación falla (§6.3). | Base de datos |

Notas:

- El alcance **no** se delega a RLS como único mecanismo: atarlo al motor de base
  dificultaría los tests sin contenedor (D4: Vitest + `fastify.inject()`).
- El `tenant_id` como columna y la política de RLS viven en `kernel-persistence`
  (adaptador de salida), nunca en el agregado (D7).
- Esto **no** re-litiga D12: la cumple y fija su postura ("RLS **o** scoping
  obligatorio" se resuelve como "scoping obligatorio **y** RLS como backstop").

---

## 10. Pruebas de conformidad

`kernel-conformance` (§4, fase 3) debe cubrir, como mínimo, **bordes y rutas
críticas** (D22, CONTRIBUTING §8): el camino feliz no cuenta.

| Escenario | Qué se verifica |
|---|---|
| Consulta con alcance poblado | Devuelve solo las filas del tenant del `ScopeContext` |
| Consulta **sin** alcance | **Lanza** (`ScopeMissingError`); la consulta no se ejecuta |
| Lectura cross-tenant | No devuelve datos de otro tenant (filtro de aplicación) |
| Backstop RLS | Con el filtro de aplicación anulado, la base **no** devuelve filas ajenas |
| Mutación cross-tenant | No aplica sobre datos de otro tenant |
| Acceso público por token | Puebla `actor.kind = 'public-token'` con el tenant del token (T9) |
| Usuario autenticado | Puebla `actor.kind = 'user'` con el tenant del usuario |
| Endpoint sin datos de tenant | No puebla ni consume alcance; no falla |
| Request sin identidad | No llega al repositorio con datos de tenant |
| `ScopeContext` inmutable | Un intento de reemplazar el alcance aguas abajo no cambia la consulta |
| Tenant plano (D25) | No existe resolución por ancestro; el alcance es una búsqueda plana |

---

## 11. Fuera de alcance / "esto no se extrae y por qué"

- **No** se extrae el **catálogo de roles y permisos**: el kernel provee la
  mecánica de identidad y alcance; el catálogo es de la vertical (§1.4). Meterlo
  sería framework especulativo (§2).
- **No** se extrae la **jerarquía de tenants**: no hay consumidor real (D25,
  §2, ODD #1/#3). El supuesto plano se escribe explícito (§7) y no se pre-diseña.
- **No** se define la **autenticación** (login social, §11.4) ni el **formato del
  token público** (T9): son contratos aparte. Acá solo su resultado como alcance.
- **No** se define el **almacenamiento concreto** de RLS ni el motor de base: es
  un adaptador (`kernel-persistence`); el contrato exige el backstop, no su
  implementación.
- **No** se incluye el **scoping de autorización en el controller**: es el
  anti-patrón de §1.2 y está prohibido (§6.1).
- **No** se incluye la **mecánica del servidor ante mutaciones** (idempotencia,
  §5.1) ni el **protocolo de la cola** (sync, §5.2).

---

## 12. Referencias

- [`docs/kernel-context.md`](../kernel-context.md) — §1.2 (scoping en el
  controller, anti-patrón), §1.3 (tenant plano), §1.4 (identidad + roles: solo la
  mecánica), §4 (`kernel-scope`), §5.3 (este contrato), §6 (prohibiciones duras),
  §8 (ALS, no providers request-scoped).
- [`docs/adr/0003-decisiones-contrato-alcance.md`](../adr/0003-decisiones-contrato-alcance.md)
  — postura de enforcement (scoping obligatorio + RLS backstop), fail-closed,
  alcance de request por token público y forma normativa del `ScopeContext`.
- [`docs/contracts/idempotency.md`](idempotency.md) — §5.1; la mutación repetida
  es un problema distinto del alcance.
- [`docs/contracts/sync.md`](sync.md) — §5.2; el protocolo de la cola es ajeno al
  alcance.
- Decisiones: D5, D11, D12, D15, D16, D22, D23, D25.
