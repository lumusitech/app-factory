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

### 1.3 El portafolio: tres productos

| Producto | Cliente | Tenant | Offline | Orden |
|---|---|---|---|---|
| **teacher-service** | docente individual | el docente | sí (aula sin wifi) | **1º** |
| **store-service** | kiosco, almacén, vendedor de ropa | el comercio | **sí, crítico** (vender sin internet) | 2º |
| **tech-service** | taller de servicios técnicos | el negocio | sí | 3º |

**Por qué ese orden**:

1. **teacher-service** — dominio chico, **un solo escritor por tenant** (sin
   conflictos de sync), offline real y acceso público por QR. Valida el kernel
   completo sin necesitar resolución de conflictos. Es el test de aceptación más
   barato. Contexto propio: `docs/teacher-service-context.md`.
2. **store-service** — exige offline fuerte (vender sin conexión) e inventario.
   Es donde el protocolo de sync se rompe **a propósito**.
3. **tech-service** — llega con el kernel ya validado dos veces.

**`school-service` se descarta** (D18): un producto de dirección escolar exige
jerarquía multi-nivel, permisos por curso y consolidación entre docentes. No es
viable como cuarta vertical por ahora. Consecuencia: el portafolio son tres
productos y **ningún vertical necesita jerarquía de tenants** — el tenant es
plano. Si algún día aparece, se evalúa con el mismo test de §2, no se pre-diseña.

El `tech-service` original **no se adapta**: queda como demo de ese producto y
como fuente de *semántica*, no de código (ver D17).

### 1.4 La intersección verificada

Lo que el kernel debe satisfacer. La columna "Veredicto" es la regla de §2.

| Capacidad | teacher | store | tech | Veredicto |
|---|---|---|---|---|
| Identidad + roles | ✓ | ✓ | ✓ | kernel — solo la **mecánica**, no el catálogo |
| Tenant | docente | comercio | negocio | kernel — **plano** (sin jerarquía) |
| **Sync offline + idempotencia** | ✓ | ✓✓ | ✓ | **kernel — el pilar más fuerte** |
| **Acceso público por token/QR** | ✓ | ✓ | ✓ | **kernel — segundo pilar** |
| Configuración por tenant | ✓ | ✓ | ✓ | **kernel (`kernel-config`)** — entra el día 1 (D19) |
| Storage de archivos | ✓ | ✓ | ✓ | kernel — puerto |
| Documentos / PDF | ✓ | ✓ | ✓ | kernel — render; **plantillas locales** |
| Notificaciones | ✓ | ✓ | ✓ | kernel — transporte, no catálogo |
| Scheduling | ✓ | ✓ | ✓ | kernel |
| Billing de plataforma | ✓ | ✓ | ✓ | kernel — diferido |
| Auditoría / log de eventos | ✓ | ✓ | ✓ | kernel (outbox, D10) |
| Órdenes / notas / stock / cursos | local | local | local | **❌ vertical** |

**Dos pilares confirmados por las tres verticales**: sync offline con
idempotencia, y acceso público por token. Ninguno de los dos se habría
identificado con una sola app — es la demostración empírica de la regla de §2.

**Advertencia sobre el alcance**: la intersección de tres productos es
**sorprendentemente chica**. Todo lo demás (`activos`, `dispositivos`, `stock`,
`cursos`, `órdenes`) es vertical. El kernel arranca flaco a propósito.

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

### D16 — La unidad es el **producto**, no el cliente
Cada producto es **un despliegue** con N tenants adentro. No se crea una app por
cliente.

- Multi-tenant resuelve *"muchos clientes, un producto"*.
- **No** resuelve *"muchos negocios distintos, un producto"*.

Tres tipos de variación, con destinos distintos:

| Variación | Destino |
|---|---|
| Marca, colores, logo | configuración por tenant (trivial) |
| Reglas del mismo producto | flags / configuración por tenant |
| **Workflow distinto** | **son productos distintos** |

Intercambio aceptado: multi-tenant cambia *riesgo de aislamiento* por *salud
operativa* (un bug afecta a todos los tenants; un deploy malo también). Se
mitiga con flags por tenant y rollback.

### D17 — `tech-service` **no se adapta**: se reescribe desde cero
El repo original queda como demo y como fuente de *semántica* (idempotencia,
sync), no de código. Consecuencia: **desaparece el problema de los dos
adaptadores HTTP** — no hay convivencia Nest+TypeORM y Fastify+Zod.

### D18 — Candidatos de kernel: se validan con la **segunda** vertical
Registrados por `teacher-service`, se confirman solo si `store-service` los
necesita. Ordenados por fuerza:

1. **`kernel-config`** — configuración por tenant que no es código (calendario,
   umbrales, plantillas, catálogos). **El candidato más fuerte**: es la misma
   familia que `business-settings` en `tech-service`, pero con semántica real de
   configuración y no de branding.
2. **Acceso público por token** — opaco, revocable, con vencimiento opcional y
   alcance definido. Nunca `WHERE code = ?` sobre un código corto.
3. **Renderizado de documentos (PDF)** — puerto; las plantillas son datos de la
   vertical.
4. **Storage de archivos** — puerto.
5. **Importación de planillas / catálogos** — decidir si es kernel o vertical.

**No se implementan ahora.** Entran al kernel cuando la segunda vertical los
pida; si solo los pide una, se quedan en la vertical.

### D19 — `kernel-config` entra el día 1, no se difiere
Es el único candidato de D18 que se promueve sin esperar a la segunda vertical.
Razón: **las tres verticales lo necesitan con la misma semántica** (calendario,
umbrales, plantillas, catálogos, flags por tenant). Diferirlo obliga a inventar
un mecanismo de configuración por vertical y luego unificarlo — trabajo doble.
Alcance mínimo: almacén clave-valor por tenant con esquema versionado y
validación. No es un CMS ni un motor de reglas.

### D20 — `tools/create-vertical` está implementado
D3 deja de ser una intención y pasa a ser una herramienta disponible. Genera una
vertical dentro del monorepo ya cableada a sync, scope, configuración y tests.
Consecuencia: la fase 4 no se difiere; se usa desde la primera vertical.

### D21 — `tech-service` es greenfield: no se copia ni se migra
No hay extracción de código, ni convivencia de frameworks, ni adaptación de
NestJS. Se escribe desde cero con el stack de D4 (Fastify + Zod) consumiendo el
kernel. El repo original queda **solo** como fuente de semántica (idempotencia,
sync) y como demo de ese producto.

### D22 — Reglas de ingeniería obligatorias
Aplican a todas las verticales y al kernel. No son recomendaciones.

| Regla | Alcance | Verificación |
|---|---|---|
| **Mobile-first** | Toda la UI. Se diseña para el celular primero; el desktop es una adaptación | Revisión en viewport móvil antes de aprobar el PR |
| **PWA instalable** | Android e iOS. La app debe instalarse y funcionar como app nativa | Test manual de instalación + Lighthouse PWA |
| **Tailwind v4+** | Estilos. Sin CSS ad-hoc ni librerías de componentes que impongan su propio design system | Configuración única en `kernel-ui` |
| **TDD obligatorio** | Toda implementación. Tests escritos antes o junto con el código | Cobertura de **bordes** y **rutas críticas**; CI bloquea si baja |

**Lo que "bordes y rutas críticas" significa en la práctica**: no se exige 100%
de cobertura. Se exige que estén cubiertos los caminos que rompen el producto —
errores de red, reintentos, duplicados, estados vacíos, permisos denegados,
límites de fecha y de monto. Un test que solo repite el camino feliz no cuenta.

### D23 — Organic Driven Development (ODD)
El sistema crece **orgánicamente desde contratos y necesidades reales**, no desde
especulaciones. Reglas operativas:

1. **Nada entra al kernel sin un consumidor real.** La intersección de §2 manda;
   lo que solo una vertical necesita se queda en la vertical.
2. **El contrato precede al código.** Primero la interfaz y los invariantes;
   después la implementación. Cambiar el contrato es un evento explícito (ADR),
   no un efecto colateral de escribir código.
3. **La segunda instancia valida la abstracción.** La primera vertical registra
   candidatos; la segunda confirma o descarta. Generalizar con n=1 está
   prohibido (§8, riesgos).
4. **Se poda.** Un paquete que ningún vertical consume se elimina o se degrada a
   la vertical. Un kernel que crece sin poda se convierte en framework.
5. **Cada feature deja el sistema más simple, no más acoplado.** Si un cambio
   agrega dependencias cruzadas entre verticales, está mal.

ODD es el criterio para resolver lo que los documentos no previeron: ante la
duda, se elige lo que mantiene la intersección pequeña y el acoplamiento bajo.

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
│   ├── teacher-service/      # 1º — docente individual (docs/teacher-service-context.md)
│   ├── store-service/        # 2º — kiosco / almacén / ropa
│   └── tech-service/         # 3º — taller técnico (greenfield: desde cero, sin NestJS)
└── tools/
    └── create-vertical/      # D3 — implementado, listo para generar verticales
```

> `tools/create-vertical` está **implementado** (D20). `kernel-ui` y los demás
> paquetes de borde aparecen cuando una vertical los consuma por primera vez;
> no se crean vacíos.

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
| **4** | `tools/create-vertical` | **Implementado** (D20). Genera una vertical cableada y con tests verdes |
| **5** | `teacher-service` **delgado**: un curso, una entidad, offline | Converge. Si no converge, el kernel no está hecho |
| **6** | `store-service` | Rompe el protocolo de sync **a propósito**. Disparador legítimo de evaluar Nx |
| **7** | `tech-service` | Greenfield desde cero (sin NestJS), con el kernel ya validado dos veces |

`school-service` **sale del portafolio** (D18): requiere adopción institucional y
jerarquía multi-nivel que ninguna vertical actual necesita. No se planifica ni
se pre-diseña.

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

### Resueltas desde la primera versión

| # | Antes | Ahora |
|---|---|---|
| 1 | ¿Multi-tenant o single-tenant? | **Multi-tenant**, un despliegue por producto con N tenants (D16). `teacher-service` instancia esto con **tenant = docente** |
| 2 | Inventario de las verticales | Hecho: 3 productos y su intersección (§1.3, §1.4) |
| 3 | ¿Registry privado? | Se mantiene `workspace:*` + changesets. Registry solo si un cliente exige repo propio (D2) |
| 4 | ¿La app Android consume el mismo protocolo? | Sí: el protocolo es documento + JSON Schema (D14). Cualquier cliente puede implementarlo |
| 5 | ¿`kernel-ui` desde el inicio? | **Sí** (D22): mobile-first, PWA y Tailwind v4+ son obligatorios, así que las primitivas de UI se necesitan desde la primera vertical |
| 6 | Nombres de las verticales | `teacher-service`, `store-service`, `tech-service` |
| 7 | ¿Reglas de ingeniería obligatorias? | **Mobile-first, PWA instalable (Android/iOS), Tailwind v4+ y TDD** (D22, D23). Detalle en §12 y en `CONTRIBUTING.md` §8–§9 |
| 8 | ¿`school-service` sigue en el portafolio? | **No** (D18). Se descarta: exige adopción institucional y jerarquía multi-nivel que ninguna vertical necesita |

### Siguen abiertas

1. **Nombre comercial de cada producto.** `teacher-service` y los demás son
   nombres internos de repo. El comercial se define antes de difundir.
2. **¿Se adopta `changesets` en la fase 0 o al publicar el primer paquete?**
   Recomendación: declarar `"version"` en cada `package.json` desde el día 1 y
   adoptar la herramienta recién cuando exista un consumidor externo real.
3. **¿La jerarquía de tenant se implementa alguna vez?**
   Ninguna de las tres verticales la necesita. Se evalúa **solo** si aparece un
   producto que la exija, con el test de §2. No es deuda latente.

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

## 11. Repo, workflow y despliegue

### 11.1 El repositorio

- **`lumusitech/app-factory`** — público, rama por defecto `main`.
- Nace con `docs/` y `.gitignore`. **No hay código todavía.**
- El commit inicial (`be94fab`) fue directo a `main`: un repo vacío no admite
  PR. Desde ese commit, **todo cambio pasa por PR**.

### 11.2 Reglas de `main` (aplicadas y verificadas)

| Regla | Efecto |
|---|---|
| PR obligatorio | Push directo rechazado: `GH006: Changes must be made through a pull request` |
| `enforce_admins: true` | **Ni el owner** puede pushear directo |
| Aprobaciones requeridas: 0 | El owner puede mergear su propio PR (GitHub no permite auto-aprobarse) |
| Historial lineal | Sin merges enredados |
| Force-push y borrado | Prohibidos |
| Resolución de conversaciones | Obligatoria antes de mergear |
| **Solo squash merge** | Sin merge commit ni rebase. Título y cuerpo salen del PR |
| Borrar rama al mergear | Activado |

Detalle operativo y convenciones: **`CONTRIBUTING.md`**.

### 11.3 Despliegue

- **Un despliegue por producto**, N tenants adentro (D16).
- El kernel se comparte **en repo y build, no en runtime**. Cada producto tiene
  su propio servicio y su propia base de datos.
- Desplegar un producto **no toca** a otro. Si cambia el kernel, se reconstruyen
  todos.

### 11.4 Modelo de negocio (estado actual)

- **Gratuito** al inicio, con login social (Google). Sin fricción de alta.
- Pago mínimo por docente/usuario **más adelante**, como contribución al
  mantenimiento, no como barrera de entrada.
- **Validación**: un docente real (el autor del producto), un ciclo lectivo
  completo, antes de generalizar.

### 11.5 Handoff — cómo arranca un chat nuevo

| Para qué | Qué pegar |
|---|---|
| Arquitectura del kernel | Prompt de §0.1 de este documento |
| Una feature de producto | Prompt de §0.1 de `docs/teacher-service-context.md`, citando `F-xx` |

Regla de trabajo: **un chat por feature o micro-cambio.** El chat cita el
documento, no la memoria de conversaciones anteriores.

---

## 12. Reglas de ingeniería obligatorias

Aplican a todas las verticales y a los paquetes del kernel. **No son
recomendaciones: son criterios de aceptación de PR.** Detalle operativo en
`CONTRIBUTING.md` §8 y §9.

### 12.1 Mobile-First y PWA (D22, T24)

| Regla | Verificación |
|---|---|
| **Mobile-first**: la UI se resuelve primero en 375 px; el desktop es adaptación | Revisión en viewport móvil antes de aprobar |
| **PWA instalable** en Android e iOS: manifiesto, service worker, caché de assets | Test manual de instalación + Lighthouse PWA |
| **Tailwind v4+** como sistema de estilos, configurado en `kernel-ui` | Sin CSS ad-hoc ni design systems ajenos |
| **Targets de toque** de 44 px mínimo; nada depende de `hover` | Revisión de UI |

Consecuencia de arquitectura: `kernel-ui` y `kernel-client` (service worker +
cola offline) se necesitan **desde la primera vertical**, no en la segunda.

### 12.2 TDD obligatorio (D22, T25)

| Regla | Verificación |
|---|---|
| Tests escritos **antes o junto** con el código | El PR incluye los tests del cambio |
| Cobertura de **bordes y rutas críticas**, no 100% de líneas | Errores de red, reintentos, duplicados, estados vacíos, permisos, límites |
| El **camino feliz no cuenta** como cobertura | Un test que solo verifica que guardar funciona no prueba nada |
| El **CI bloquea el merge** si un test falla o baja la cobertura crítica | Configuración de CI |
| Un PR sin tests no se aprueba | Checklist de PR |

### 12.3 Organic Driven Development — ODD (D23)

1. Nada entra al kernel sin un consumidor real (§2, intersección).
2. El contrato precede al código; cambiarlo es un evento explícito (ADR).
3. La segunda instancia valida la abstracción; generalizar con n=1 está prohibido.
4. Se poda: un paquete sin consumidores se elimina o se degrada a la vertical.
5. Cada feature deja el sistema más simple y menos acoplado, no más.

---

*Documento generado a partir de una auditoría read-only de `tech-service` y de
las decisiones de diseño posteriores. No contiene código de ese repo.*
