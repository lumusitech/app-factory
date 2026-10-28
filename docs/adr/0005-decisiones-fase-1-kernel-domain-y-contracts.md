# 0005 — Materialización de `kernel-domain` y `kernel-contracts`

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.4, §4, §4.1, §5, §6, §7, §8;
  D5, D6, D8, D9, D10, D14, D15, D22, D23, D24; `docs/contracts/` (los cuatro
  contratos); [ADR 0001](0001-decisiones-contrato-idempotencia.md)–[0004](0004-decisiones-contrato-evolucion.md);
  PR de la fase 1.

## Contexto

La fase 1 (§7) entrega `kernel-domain` + `kernel-contracts` con un criterio de
salida nítido: *"compila sin ninguna dependencia externa"*. Es la primera vez que
el monorepo tiene código, así que hay que fijar la forma de lo que §4/§4.1 nombran
pero no detallan.

Cuatro frentes quedaron abiertos y ninguna `D*` los cierra:

1. **El catálogo de códigos de error.** Los ADR [0001](0001-decisiones-contrato-idempotencia.md)
   y [0002](0002-decisiones-contrato-sync.md) lo difieren explícitamente a
   `kernel-contracts`; `docs/contracts/idempotency.md` §10 y
   `docs/contracts/sync.md` §9 dicen que "el nombre exacto del código de conflicto
   se define en `kernel-contracts`". Materializarlo ahora es cerrar ese
   diferimiento.
2. **La forma de los puertos y del evento.** §4/§4.1 dan firmas
   (`IdGenerator`, `Clock`, `UnitOfWork`, `OutboxPort`, `DomainEvent`) pero no la
   forma concreta del evento ni de la unidad de trabajo.
3. **La pregunta de los modelos compartidos.** Si `kernel-domain` debe incluir
   *Value Objects* genéricos compartibles entre verticales, o si agregados y VOs
   se quedan (y se duplican) en cada vertical.
4. **El empaquetado de `sync-protocol.md`.** §4 asigna a `kernel-contracts` un
   `sync-protocol.md`, que podría duplicar `docs/contracts/sync.md` (§8 registra
   el riesgo "contrato OpenAPI duplicado").

Este ADR es el evento explícito de D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y el disparador de [`docs/adr/README.md`](README.md) ("se
introduce … un contrato nuevo" / "un límite de paquete"). **No duplica** lo que ya
vive en §4/§4.1/§5 ni en D5/D6/D8/D9/D10/D15: solo fija lo que aún no está
decidido.

## Decisión

1. **Inventario de `kernel-domain`: solo mecánica.** El paquete expone el tipo
   base `DomainEvent` y los puertos `IdGenerator`, `Clock`, `UnitOfWork` y
   `OutboxPort`. **No** incluye `Repository<T>` genérico (D6), ni *value objects*,
   ni bases de agregado/entidad: los agregados y sus VOs son de cada vertical
   (§1.4, `docs/contracts/not-extracted.md` §3).
2. **Sin VOs genéricos por ahora, con disparador.** Un VO se admite al kernel
   solo si supera el test de §2 (semántica idéntica en dos verticales) y existe la
   **segunda instancia** (D18, ODD #3). Mientras eso no ocurra, un VO idéntico en
   dos verticales **se duplica**: duplicar es el costo aceptado hasta que la
   segunda instancia confirme la abstracción, y generalizar con n=1 está prohibido.
3. **Catálogo de códigos de error.** Se define el mínimo, cada uno con su status
   HTTP: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404),
   `IDEMPOTENCY_CONFLICT` (409; cubre la concurrencia de §6 y el reuso de key de
   §7), `SYNC_VERSION_CONFLICT` (409; política `blocked` de §8.2), `SCOPE_MISSING`
   (500; scope §6.2) e `INTERNAL_ERROR` (500). Los conflictos de **idempotencia** y
   de **versión de sync** son códigos **distintos**: son causas distintas. El
   catálogo es mínimo y crece con consumidores reales (ODD #1), no por anticipado.
4. **Forma de los puertos y del evento.**
   `DomainEvent<TPayload>` = `{ id, type, aggregateId, occurredAt: Date, payload }`
   con `payload` genérico (el kernel no conoce tipos de entidad, §8);
   `OutboxPort.append(events: readonly DomainEvent[]): Promise<void>`, que
   participa de la transacción del `UnitOfWork`;
   `UnitOfWork<TRepositories = unknown>` parametrizado por el bag de repositorios
   (§4.1), sin imponer un repositorio genérico prohibido por §6.
5. **Envelope de transporte.** `Envelope<T> = { statusCode, data, timestamp }` y
   `ErrorEnvelope = { statusCode, message, error: string | null, timestamp }`, con
   `timestamp` en ISO 8601 (`string`). `kernel-contracts` **no** exporta tipos de
   entidad (§8): `data` es genérico y lo decide cada endpoint.
6. **`sync-protocol.md` sin doble fuente.** `docs/contracts/sync.md` sigue siendo
   la fuente **normativa**; el paquete incluye un documento de protocolo que la
   **cita y resume** junto al `QueuedRequest` JSON Schema, para distribuir a
   clientes (D14). El paquete no re-decide el protocolo.
7. **Frontera: `kernel-contracts` también sin deps externas.** Se añade una regla
   espejo de `kernel-domain-is-framework-free` para `kernel-contracts`. Los
   archivos de **test** (`*.test.ts`, `*.test-d.ts`) quedan exentos del gate: usan
   `vitest`/`ajv` como `npm-dev`, que en runtime sería violación y en un test es
   legítimo.

## Consecuencias

- **Se gana** la fase 1 materializada con **cero dependencias externas** en
  runtime; el catálogo de errores deja de estar diferido; los puertos tienen forma
  fija y `DomainEvent`/`OutboxPort`/`UnitOfWork` quedan acordados para la fase 2.
- **Se gana** una única fuente del protocolo: el paquete distribuye, el contrato
  decide.
- **Se paga** que `kernel-domain` nace **sin modelo** (a propósito): si dos
  verticales necesitan el mismo VO o el mismo agregado, se duplica hasta que la
  segunda instancia habilite la admisión. Es deliberado (ODD #3), no un olvido.
- **Se paga** que el catálogo de códigos crecerá con cada consumidor real en
  lugar de "por si acaso".
- **Fuera de alcance:** `kernel-scope` (`ScopeContext` vive ahí, §4/§5.3, fase 2),
  `kernel-http`, `kernel-persistence`, `kernel-config`; la determinación del
  tenant y la autenticación (contratos aparte); la implementación del interceptor
  de idempotencia y de la cola (fases 2/3).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Incluir VOs genéricos (`Money`, `Email`, `Period`) en `kernel-domain` | Sin consumidor real y sin segunda instancia: contradice §2 ("la intersección, nunca la unión"), §6 y ODD #1/#3 |
| Un `Repository<T>` base genérico | Prohibido por D6 y §6 (*"no `Repository<T>` genérico ni CRUD universal"*) |
| Un solo código de conflicto para idempotencia y sync | Confundiría dos causas distintas (reuso de key vs. escritura obsoleta) y obligaría al cliente a adivinar |
| Copiar `docs/contracts/sync.md` dentro del paquete | Crearía una segunda fuente de verdad, justo el riesgo "contrato duplicado" de §8 |
| Tipar `ErrorEnvelope.error` como `ErrorCode` | Acoplaría el transporte al catálogo del kernel y no permitiría códigos de terceros; se deja `string \| null` |
| No añadir la regla de frontera de `kernel-contracts` | Dejaría el criterio "cero deps" sin gate para el segundo paquete de la fase 1 |
| Instalar `changesets` o validadores en runtime | D24 lo difiere al primer consumidor externo; un validador de schema es de test, no de runtime (ODD #1) |
