# app-factory — Contexto, decisiones y estado

> Documento de arranque del repo. Autocontenido: no requiere leer el repo
> `tech-service`. Si algo aquí contradice al código, el código gana y este
> documento se corrige.

---

## 0. Cómo usar este documento

- **Para humanos**: secciones 1–3 dan el "por qué". Secciones 4–7, el "qué".
- **Para agentes**: la sección 3 son decisiones cerradas (no re-litigar), la 6
  son prohibiciones duras, y la 9 es lo único abierto a propuesta.
- Si una tarea exige violar una decisión de la sección 3: **para y pregunta**.

### 0.1 Prompt de arranque para un chat nuevo

> Copiar y pegar como primer mensaje en la instancia nueva.
>
> ```
> Estamos en el repo app-factory. Leé docs/kernel-context.md completo antes de
> responder. Es un monorepo de kernel compartido entre verticales, empezado
> desde cero: no hay código todavía.
>
> Tratá la sección 3 (Decisiones cerradas) como vinculante y la sección 6
> (Prohibiciones duras) como restricciones que no podés violar sin preguntar.
> La sección 9 es lo único abierto a propuesta.
>
> Antes de escribir código, confirmame: (a) qué fase de la sección 7 vamos a
> ejecutar, (b) qué decisiones de la sección 9 siguen sin resolver y bloquean
> esa fase.
> ```

---

## 1. Origen: qué se auditó y qué se aprendió

Se auditó (solo lectura) `tech-service`: un producto de gestión de órdenes de
servicio técnico, en dos repos hermanos — backend NestJS 11 + TypeORM +
PostgreSQL, frontend Angular 22 standalone/signals + Tailwind 4 + PWA.

**Veredicto**: es una vertical madura y con buena red de tests, no un prototipo.
Sirve como *evidencia*, no como plantilla. Se queda como demo de ese producto y
**no es el producto final vendible**.

### 1.1 Activos reales que valen como patrón (cosechar, no copiar)

| Activo | Por qué importa |
|---|---|
| **Idempotencia servidor** | Interceptor global en mutaciones; hash `SHA-256(userId\|method\|path\|key)`; TTL 48h; replay devuelve la respuesta almacenada sin re-ejecutar; fail-open si el store falla. Probado con spec propio |
| **Cola offline cliente** | IndexedDB con estados `pending`/`blocked`; replay FIFO; 2xx→borra, 401→blocked, 4xx→blocked (visible, nunca se descarta), 5xx/red→se conserva y corta; watchdog de 20s |
| **Caché GET offline** | TTL 7 días, LRU 500, guarda el body ya desenvuelto |
| **Protocolo de replay** | Headers `Idempotency-Key` + `X-Offline-Replay`; bypass explícito para probes (`X-Connectivity-Probe`) |
| **Contrato de transporte** | Envelope `{statusCode, data, timestamp}`; errores `{statusCode, message, error, timestamp}`; paginación `{data,total,page,limit,totalPages}` |
| **Codegen contract-first** | OpenAPI → tipos TypeScript del frontend. El front nunca escribe tipos a mano |
| **Suite de convergencia** | E2E: crear offline → reconectar → sincronizar → verificar que no se duplica |
| **Whitelist de ORDER BY** | Protección contra inyección en ordenamiento, con e2e propio |

### 1.2 Anti-patrones observados (NO replicar)

| Anti-patrón | Evidencia |
|---|---|
| **Entidad ORM == modelo de dominio** | TypeORM es dueño del agregado; sin separación dominio/infra |
| **Scoping de autorización en el controller** | `filterDto.technicianId = user.id` escrito a mano por endpoint → opt-in, fácil de olvidar |
| **"Multi-tenant" que solo es branding** | Existe `business-settings` (nombre/logo/colores) pero cero `tenant_id`, cero RLS |
| **Historial de migraciones squasheado** | 31 migraciones, 8 llamadas `*Init`; `migration:revert` disponible (sin forward-only) |
| **Motor offline conociendo el dominio** | Hardcodea endpoint de probe, lista de rutas no encolables y un refresh key del dominio |
| **Eventos in-process como si fueran durables** | `EventEmitter2` no sobrevive a rollback ni a reinicio |
| **ID generado por la base** | `@PrimaryGeneratedColumn('uuid')` → el dominio no conoce el ID antes del INSERT |

**Conclusión del origen**: el kernel no se extrae del repo. Se escribe contra
contratos, y el repo solo aporta la *semántica* de idempotencia y sync, que ya
está validada por tests.

---

## 2. La regla que gobierna todo

> **El kernel satisface la intersección de las verticales, nunca la unión.**
> Lo que solo necesita una vertical se queda en esa vertical.

Corolario operativo: cada vez que algo entra al kernel "por si acaso", ya se
perdió. La pregunta de admisión es brutal y simple:

> ¿Una app de asistencia docente y una de inventario de almacén necesitan esto
> **con exactamente la misma semántica**?

Si la semántica difiere, no es kernel: es una **política que la vertical
configura**.

### 2.1 Los tres cubos

1. **Kernel-esencial** — invariantes con semántica idéntica en cualquier vertical.
2. **Accidentalmente-de-dominio** — parece infraestructura, pero codifica las
   reglas de una vertical.
3. **Local** — genuinamente del producto.

---

## 3. Decisiones cerradas

Cada una con su razón. No re-litigar sin evidencia nueva.

### D1 — Monorepo con paquetes, no template repo
Un template repo copia código: cada producto nace con una fotografía y los fixes
se aplican N veces. El monorepo tiene **una fuente de verdad**: un fix, N
verticales actualizadas.

### D2 — El kernel se publica con semver desde el día 1, consumido por workspace linking
No hace falta registry al principio. Se versiona con `changesets` +
`publishConfig` privado. El día que un cliente exija repo propio, ese producto
importa `@kernel/x@1.4.0` sin refactor. **Decisión: no acoplarse al workspace.**

### D3 — `tools/create-vertical` es lo que convierte "monorepo" en "plantilla"
No es un template repo: es un generador que crea una vertical *dentro* del
monorepo, ya cableada a sync, scope y tests.

### D4 — Stack backend: **Fastify + Zod + composition root manual**
Descartados: **NestJS** (decoradores en el dominio, request-scope que contamina el
grafo, módulos por carpeta técnica, `forFeature` filtrándose al dominio) y
**Express** (no aporta nada sobre Fastify con tipos).

- Validación y contrato: Zod → JSON Schema → OpenAPI
  (`fastify-type-provider-zod` + `@fastify/swagger`).
- El schema es la fuente; no hay decoradores paralelos.
- Tests: Vitest + `fastify.inject()`, sin levantar contenedor.
- Baterías: `@fastify/rate-limit`, `@fastify/websocket`, `node-cron`, health propio.
- Si el wiring manual duele a escala: `awilix` o `tsyringe`, **sin tocar el dominio**.

### D5 — Ningún framework entra en `kernel-domain`
Ni Fastify, ni Zod, ni ORM. Solo TypeScript. Esto hace reversible la decisión de
D4: mañana un adaptador Nest, Lambda o worker se añade sin reescribir el kernel.

### D6 — Arquitectura hexagonal, pero **solo donde hay invariantes**
Puertos por agregado, no repositorios genéricos (un `Repository<T>` genérico es
*inner platform effect*). Aplica a agregados con **máquina de estados o dinero**.
CRUD sin invariantes se queda pragmático: envolverlo es ceremonia sin retorno.

### D7 — El ORM es un **adaptador de salida**, nunca el modelo
Entidad de persistencia separada del agregado + mapper explícito. Se paga en
mappers; se cobra en invariantes auditables.

### D8 — IDs generados en el dominio (UUIDv7), no por la base
Puerto `IdGenerator`. Permite construir el agregado completo en memoria y emitir
eventos consistentes antes del `INSERT`.

### D9 — Eventos de dominio vía **outbox**, no `EventEmitter`
El evento se escribe en la misma transacción que el agregado y se publica
después. `EventEmitter`-style in-process solo para notificaciones efímeras.

### D10 — El outbox **es** el log de sincronización
Resuelve a la vez: durabilidad de eventos, replay desde servidor y auditoría.
No se necesita un log aparte.

### D11 — Alcance (usuario/tenant) se aplica en una capa común, no en el controller
Contexto por `AsyncLocalStorage` poblado en el borde; el repositorio lo consume.
Objetivo: **imposible de olvidar**, no opt-in.

### D12 — Multi-tenancy real desde el inicio, o explícitamente single-tenant
No se repite el caso `tech-service` (branding presentado como multi-tenant). Si
hay `tenant_id`, hay RLS o un scoping obligatorio; si no lo hay, se documenta que
cada despliegue es un cliente.

### D13 — Migraciones: forward-only, un dueño por paquete
Prohibido acumular `*Init`. Si se hace squash, es un procedimiento explícito con
ventana, no un reflejo.

### D14 — El protocolo de sync es un **documento + JSON Schema**, no código Angular
Requisito: una app Android (Jetpack Compose) o cualquier otro cliente debe poder
implementarlo. El código es una implementación de referencia.

### D15 — Fronteras impuestas por herramienta desde el día 1
`eslint no-restricted-imports` o `dependency-cruiser`:
- `apps/*` no importa de `apps/*`
- `packages/kernel-*` no importa de `apps/*`
- `kernel-domain` no importa ningún framework ni driver

Nx solo si la tercera vertical duele. Las reglas se necesitan antes que Nx.

---

## 4. Arquitectura objetivo

```
app-factory/
├── packages/
│   ├── kernel-domain/        # TS puro, CERO deps.
│   │                         #   Aggregates, Value Objects, DomainEvent,
│   │                         #   puertos: <Agg>Repository, IdGenerator, Clock,
│   │                         #   OutboxPort, UnitOfWork
│   ├── kernel-contracts/     # envelope, headers (Idempotency-Key, X-Offline-Replay,
│   │                         #   X-Connectivity-Probe), error codes,
│   │                         #   QueuedRequest JSON Schema, sync-protocol.md
│   ├── kernel-http/          # adaptador Fastify: rutas, middleware, Zod→OpenAPI,
│   │                         #   idempotencia, envelope, filtro de errores
│   ├── kernel-persistence/   # adaptador ORM: entidades, mappers, migraciones,
│   │                         #   outbox publisher, repositorios concretos
│   ├── kernel-scope/         # ALS ScopeContext + aplicación obligatoria del alcance
│   ├── kernel-client/        # cola offline, caché GET, flush, connectivity (parametrizado)
│   ├── kernel-ui/            # tokens + primitivas (solo el borde es framework-specific)
│   └── kernel-conformance/   # suite de convergencia (el "test de aceptación del kernel")
├── apps/
│   ├── vertical-a/
│   └── vertical-b/
└── tools/
    └── create-vertical/
```

**Por qué el kernel se divide por runtime y no por capa**: `kernel-domain` y
`kernel-contracts` son compartidos; el resto son adaptadores. Un paquete de
"tipos compartidos back/front" duplicaría el contrato OpenAPI → dos fuentes de
verdad.

### 4.1 Puertos: forma correcta

```ts
// kernel-domain — cero dependencias
export interface WorkOrderRepository {
  byId(id: WorkOrderId): Promise<WorkOrder | null>;
  save(order: WorkOrder): Promise<void>; // incluye outbox en la misma transacción
}
export interface IdGenerator { next(): string }
export interface Clock { now(): Date }
export interface UnitOfWork {
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
```

Cuatro métodos que el dominio necesita. No veinte que el ORM ofrece.

---

## 5. Contratos a escribir antes que código

Cuatro secciones, 6–8 páginas. Es el entregable real de la fase de diseño.

1. **Contrato de idempotencia** — precondición (mutación + header + usuario
   autenticado), clave de hash, TTL, semántica de replay (misma respuesta, sin
   re-ejecución), comportamiento ante fallo del store (fail-open).
2. **Contrato de sync** — estados `pending`/`blocked`; transiciones
   `2xx→remove`, `401→blocked`, `4xx→blocked`, `5xx/red→conservar y cortar`;
   FIFO; watchdog; headers de replay. **Incluye la decisión explícita de que no
   hay merge**: conflicto = `blocked` + resolución humana. Es una decisión, no
   una carencia.
3. **Contrato de alcance** — forma del `ScopeContext`, dónde se puebla, dónde se
   aplica, y la prueba de que es imposible de omitir.
4. **Contrato de evolución** — dueño de migraciones por paquete, forward-only,
   procedimiento de squash.

Y una lista de **"esto no se extrae y por qué"**.

---

## 6. Prohibiciones duras

- **No** meter en el kernel nada que solo una vertical necesite.
- **No** `Repository<T>` genérico ni abstracción CRUD universal.
- **No** decoradores ni imports de framework en `kernel-domain`.
- **No** entidad ORM como modelo de dominio.
- **No** reglas de negocio en controllers, guards o interceptors.
- **No** `EventEmitter` in-process para eventos que deban sobrevivir a rollback.
- **No** IDs generados por la base.
- **No** nuevas migraciones `*Init` sin procedimiento documentado.
- **No** exponer el protocolo de sync solo como código Angular.
- **No** llamar "multi-tenant" a theming.

---

## 7. Plan por fases

| Fase | Qué | Criterio de salida |
|---|---|---|
| **0** | Contratos (sección 5) + reglas de frontera en CI | Los 4 contratos revisados; `dependency-cruiser` falla si se rompe una frontera |
| **1** | `kernel-domain` + `kernel-contracts` | Compila sin ninguna dependencia externa |
| **2** | `kernel-http` + `kernel-persistence` + `kernel-scope` | Un agregado con invariantes persiste, emite outbox y respeta alcance |
| **3** | `kernel-client` + `kernel-conformance` | El test de convergencia pasa end-to-end |
| **4** | `tools/create-vertical` | Genera una vertical cableada y con tests verdes |
| **5** | Vertical 2 **delgada** (una entidad, un flujo, offline) | Converge. Si no converge, el kernel no está hecho |
| **6** | Vertical 3 | Es el disparador legítimo de evaluar Nx |

**La fase 3 es la que se salta todo el mundo.** Un kernel no está "hecho" hasta
que soporta: *crear entidad → trabajar offline → sincronizar → converger →
reintentar sin duplicar*. Si eso no pasa, es una carpeta de utilidades.

---

## 8. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Generalizar desde n=1 | Prohibido extraer del repo; se escribe contra contratos. Inventario de 1 página por vertical antes de la fase 1 |
| Framework especulativo | El kernel lo usa *tu* vertical, no el mundo. La intersección manda |
| Coste de mappers | Strangler por agregado; no hexagonal en CRUD |
| Composition root creciendo | Aceptable y explícito; `awilix` si duele, sin tocar dominio |
| Contexto de scope contaminando el grafo | ALS, no providers request-scoped |
| Transacciones mal resueltas | `UnitOfWork` como puerto desde el día 1 |
| Contrato OpenAPI duplicado | `kernel-contracts` no exporta tipos de entidad; solo envelope, headers, códigos y schemas de protocolo |

---

## 9. Preguntas abiertas

1. ¿Multi-tenant real desde el inicio o single-tenant explícito? (D12 obliga a
   decidirlo antes de la fase 2).
2. Inventario de las verticales 2–5: entidades, ¿offline sí/no?, concurrencia,
   hardware. Una página cada una.
3. ¿Hay entrega de código a clientes que justifique registry privado en el corto
   plazo, o basta `workspace:*` + changesets?
4. ¿La app Android futura consume el mismo protocolo de sync o solo lectura?
5. ¿Se adopta `kernel-ui` desde el inicio o se pospone hasta la vertical 2?
6. Nombre definitivo de las verticales de prueba (`vertical-a`/`vertical-b` son
   placeholders).

---

## 10. Nivel de certeza

- **Nivel 1** (verificado o estándar documentado): la regla de intersección; el
  riesgo de generalizar desde una instancia; la semántica de idempotencia y sync
  cosechada de `tech-service`; que el outbox resuelve durabilidad + replay;
  `AsyncLocalStorage` como mecanismo de contexto; Zod→OpenAPI como pipeline
  contract-first; `fastify.inject()` para tests sin contenedor.
- **Nivel 2** (práctica razonada, sin fuente exacta): que Fastify+Zod sea mejor
  que Nest para este caso concreto; que hexagonal solo en agregados con
  invariantes sea el corte correcto; que `eslint`/`dependency-cruiser` baste
  hasta la tercera vertical.
- **Nivel 3** (⚠️ especulativo): estimaciones de esfuerzo por fase; cuánto de la
  lógica de `WorkOrder` es realmente extraíble sin reescritura; el número de
  mappers que saldrán caros.

---

*Documento generado a partir de una auditoría read-only de `tech-service` y de
las decisiones de diseño posteriores. No contiene código de ese repo.*
