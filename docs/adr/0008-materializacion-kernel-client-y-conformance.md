# 0008 — Materialización de `kernel-client` y `kernel-conformance`

- **Estado:** propuesto
- **Fecha:** 2026-10-29
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.1 (cola offline, protocolo de
  replay, caché GET), §1.2 (anti-patrón "motor offline conociendo el dominio"),
  §4, §5.2, §6, §7 (fase 3), §8; D4, D5, D9, D10, D14, D15, D22, D23, D25;
  `docs/contracts/sync.md`, `docs/contracts/idempotency.md`,
  `docs/contracts/scope.md`; [ADR 0001](0001-decisiones-contrato-idempotencia.md),
  [0002](0002-decisiones-contrato-sync.md),
  [0005](0005-decisiones-fase-1-kernel-domain-y-contracts.md),
  [0006](0006-decisiones-fase-2-kernel-http-persistence-scope.md); PR de la fase 3.

## Contexto

La fase 3 (§7) entrega `kernel-client` + `kernel-conformance` con un criterio de
salida nítido: *"el test de convergencia pasa end-to-end"*. La §7 avisa que un
kernel no está "hecho" hasta que soporta *crear entidad → trabajar offline →
sincronizar → converger → reintentar sin duplicar*.

[ADR 0006](0006-decisiones-fase-2-kernel-http-persistence-scope.md) punto 6 difirió
a la fase 3 "la **detección y la señal de conflicto de sync**" y la **cola/flush**;
[ADR 0002](0002-decisiones-contrato-sync.md) fijó la política de conflicto
(`blocked` por defecto, `lww` opt-in nunca silenciosa, detección por token
**opaco** cuyo formato es de la vertical). [`docs/contracts/sync.md`](../contracts/sync.md)
§10 enumera las pruebas de conformidad **mínimas** y §11 saca del contrato la
entrega proactiva a otros dispositivos.

Al materializar la fase aparecen puntos que ninguna `D*` ni los contratos cierran:

1. **La forma del cliente.** §4 pide "cola offline, caché GET, flush, connectivity
   (parametrizado)" y §1.2 prohíbe el anti-patrón "motor offline conociendo el
   dominio"; §12.1 dice que `kernel-client` (service worker + cola) se necesita
   desde la primera vertical. No se decide **cómo** se parametriza ni **dónde**
   vive cada adaptador.
2. **La caché GET.** §1.1 fija TTL 7 días, LRU 500 y "body ya desenvuelto", pero no
   la **clave** de la entrada ni **quién** aplica el TTL y el desalojo.
3. **El watchdog.** §5.2 fija 20 s, pero no cómo se prueba sin esperar 20 s reales
   ni cómo se inyecta el temporizador sin depender de un navegador (D4).
4. **El contrato de conflicto en el cable.** [`sync.md`](../contracts/sync.md) §7
   pone `baseVersion` en el item y §8.1 dice que "el cliente lo envía por request",
   pero **no** fija si viaja en un header o en el body; tampoco **dónde** viaja la
   **señal de sobrescritura** del `lww`.
5. **El alcance de la fase.** D10 dice que "el outbox **es** el log de
   sincronización" y resuelve "replay desde servidor"; hay que decidir si la fase 3
   incluye un **endpoint de pull** (cambios-desde-cursor) para convergencia de ida
   y vuelta, o solo el cliente y la suite.
6. **La forma de `kernel-conformance`.** §4 la llama "suite de convergencia (el
   'test de aceptación del kernel')" y D23 la señala como la excepción explícita a
   ODD #1, pero no define si es un paquete, dónde vive, ni con qué agregado se
   prueba un kernel que **no tiene** agregados (§1.4, ADR 0005 punto 1).
7. **Las fronteras nuevas** (D15): qué reglas impiden que `kernel-client` se acople
   a frameworks o a los adaptadores.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un evento
explícito (ADR)") y el disparador de [`docs/adr/README.md`](README.md) ("se
introduce … una dependencia, un límite de paquete o un contrato nuevo"). **No
duplica** lo que ya vive en §4/§5.2, en los contratos ni en D1–D25: solo fija lo
que aún no está decidido.

## Decisión

1. **`kernel-client` es un núcleo parametrizado por puertos, sin dominio adentro.**
   El paquete expone `SyncClient` y los puertos que necesita —
   `QueueStore` (persistencia de la cola), `GetCacheStore` (persistencia de la
   caché GET), `Transport` (transporte), `ConnectivityProbe` + `ProbeSpec`
   (conectividad), `Scheduler` (watchdog) y `OfflinePolicy` (qué mutaciones se
   encolan)— más adaptadores de **referencia en memoria** y adaptadores de
   `Clock`/`IdGenerator` reusando `@kernel/domain`. **Sin APIs de navegador**:
   el núcleo no usa `fetch`, `indexedDB`, `localStorage` ni `navigator.onLine`, de
   modo que es testeable con Vitest sin navegador real (D4) y portable a una app
   Android (D14). El anti-patrón §1.2 se elimina por diseño: el endpoint de probe
   es un `ProbeSpec` inyectado, las rutas no encolables son un predicado de
   `OfflinePolicy`, y no hay ningún "refresh key" del dominio.
2. **El adaptador IndexedDB no entra en la fase 3.** Es un adaptador de salida sin
   consumidor real hoy (la primera vertical es `teacher-service`, fase 5): se
   difiere con ODD #1 y `CONTRIBUTING.md` §7. La fase entrega el **puerto** y un
   adaptador en memoria; el navegador lo implementa cuando exista el consumidor.
3. **Caché GET normativa (§1.1), con la clave y el desalojo fijados acá.** La clave
   es un `string` que elige el llamador (en la práctica, method + path); el TTL es
   de **7 días**, el máximo es **LRU de 500** entradas, y la entrada guarda el
   **`data` del envelope ya desenvuelto**. El TTL y el desalojo los aplica el
   **núcleo** (`GetCache`) sobre el `GetCacheStore`; el adaptador solo persiste.
4. **El watchdog se inyecta por el puerto `Scheduler`.** El intento se acota con un
   temporizador programable; al vencer, el item **se conserva** en `pending` y el
   flush **se corta** (§5.2). Un `ManualScheduler` de referencia permite vencer el
   watchdog en un test sin esperar 20 s reales; no se usa un temporizador global en
   el núcleo.
5. **El conflicto de versión: token opaco, header de request y señal en el
   envelope.** El token es **opaco** (sync §8.1): el kernel **no** fija su formato.
   - El cliente envía el `baseVersion` del item como header **`X-Sync-Base-Version`**
     (se agrega a `HEADERS` en `kernel-contracts`).
   - El servidor expone `hasVersionConflict`/`resolveVersionConflict` y
     `syncVersionConflictError` en `kernel-http`: compara el token entrante con el
     vigente (que aporta la vertical) y resuelve según la política. `blocked`
     (default) → `409 SYNC_VERSION_CONFLICT`; `lww` (opt-in) → se aplica y se
     devuelve la **señal de sobrescritura**.
   - La señal viaja como campo **opcional `Envelope.sync`** (`{previousVersion,
     actor, deviceLabel, at}`), no en un header: mantiene el cuerpo en JSON, sin
     problemas de codificación, y no toca el `data` de la entidad. `previousVersion`
     es la versión que la escritura entrante **pisó** (la vigente antes de
     aplicarla).
   - Las formas `SyncPolicy`, `OverwriteSignal` y `parseOverwriteSignal` viven en
     `kernel-contracts` (mismo criterio que el registro de idempotencia, ADR 0006
     punto 5: *seam* compartido por cliente y borde, sin dependencias y sin ciclo).
   `lww` **nunca** es silenciosa (§8.2): sin un portador de la señal, la política
   no se implementa. El **formato del token** sigue siendo decisión de la vertical
   y disparará **su propio ADR** (ADR 0002, consecuencias).
6. **Alcance de la fase 3: push-only; sin endpoint de pull.** Se implementa la
   **cola del cliente** y su **contraparte servidor** (`409`, señal `lww`) y la
   **suite de convergencia**, pero **no** un endpoint servidor de
   cambios-desde-cursor. Razones: (i) `sync.md` §11 excluye la entrega cross-device
   y **no existe** un contrato de pull —crearlo sería un contrato nuevo con su
   propio ADR (D23.2)—; (ii) no hay consumidor real (el kernel no tiene modelo de
   entidades; el pull es específico de la vertical) — ODD #1, `CONTRIBUTING.md` §7;
   (iii) el criterio de salida se satisface con push + idempotencia, y toda la
   tabla de conformidad de `sync.md` §10 es de la cola. D10 se **respeta**: el
   outbox **es** el log de sincronización y ya es *cursor-ready*
   (`tenant_id, occurred_at` + `id` UUIDv7); "replay desde servidor" queda como
   capacidad **latente** que la primera vertical que la necesite materializará con
   su propio ADR.
7. **`kernel-conformance` es la suite de aceptación, la excepción de ODD.** Es un
   paquete de **tests** (D23: "la excepción explícita") que consume el kernel por
   sus **APIs públicas** —`kernel-http` + `kernel-persistence` + `kernel-scope` +
   `kernel-client`— contra **PGlite** (Postgres real, sin contenedor, D4) y
   `fastify.inject()`. Prueba un **agregado de referencia** (con `version` como
   token opaco), que **no** es un agregado del kernel (§1.4; ADR 0005 punto 1), con
   el mismo patrón que el criterio de salida de la fase 2. Cubre, como mínimo, las
   tablas de conformidad de `sync.md` §10, `scope.md` §10 e `idempotency.md` §11.
8. **Fronteras (D15).** Se agregan dos reglas con fixtures y self-test:
   `kernel-client-is-framework-free` (solo local/core y `@kernel/domain`/
   `@kernel/contracts`) y `kernel-client-no-adapters` (prohibido importar
   `kernel-http`/`kernel-persistence`/`kernel-config`/`kernel-scope`). Un cliente
   parametrizado por puertos no conoce ningún adaptador: es la versión estructural
   del anti-patrón §1.2.

## Consecuencias

- **Se gana** la fase 3 materializada con su criterio de salida: la suite prueba
  *crear → offline → sincronizar → converger → reintentar sin duplicar*, con
  bordes (red, watchdog, `5xx`, `4xx`/`401`, FIFO, head-of-line, conflicto
  `blocked`/`lww`, replay idempotente, alcance, esquema del item).
- **Se gana** un cliente **portable y sin dominio** (D14, §1.2): el protocolo se
  implementa desde un documento + JSON Schema, y el núcleo no usa APIs de
  navegador; un adaptador Angular, uno Android o los tests lo cablean por igual.
- **Se gana** un conflicto **nunca silencioso** con política explícita por vertical
  y un token opaco: el kernel no pre-diseña el modelo de datos de ninguna vertical.
- **Se paga** que el `baseVersion` viaja en un header nuevo
  (`X-Sync-Base-Version`) y la señal en un campo nuevo del envelope (`sync`): son
  **ampliaciones** de `kernel-contracts` respecto de ADR 0005, admitidas por
  consumidor real (ODD #1), sin dependencias y sin ciclo.
- **Se paga** que la detección de conflicto **necesita** que la vertical aporte la
  versión vigente y elija el formato del token (su propio ADR): el kernel solo
  compara y resuelve.
- **Se paga** que "replay desde servidor" (D10) queda **latente** hasta que una
  vertical lo pida; se documenta como capacidad diferida, no como carencia
  silenciosa.
- **Se paga** que `kernel-conformance` es un paquete que **no** se consume como
  librería: su producto son los tests. Es la excepción de ODD #1 (D23), declarada.
- **Fuera de alcance:** el adaptador IndexedDB (fase 5); el endpoint de pull;
  la entrega proactiva cross-device y el modelo aceptar/rechazar (sync §11); el
  formato del token de versión (vertical); la autenticación y la emisión del token
  público (contratos aparte); el catálogo de roles/permisos (vertical, §1.4);
  `kernel-ui`.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Un cliente de navegador con `IndexedDB`/`fetch` cableados | Rompe D4 (no se puede testear sin navegador), contradice D14 (no es portable a Android) y reintroduce el anti-patrón §1.2 (el motor conoce la plataforma y el dominio) |
| Incluir ya el adaptador IndexedDB | No hay consumidor real hasta `teacher-service` (fase 5): "por si acaso" viola §2, ODD #1 y `CONTRIBUTING.md` §7 |
| Un endpoint de pull (cambios-desde-cursor) en la fase 3 | No existe contrato de pull (`sync.md` §11 lo excluye) ni consumidor real (el kernel no tiene entidades); sería un contrato nuevo con su ADR, y el criterio de salida se cumple sin él |
| Implementar solo `blocked` y diferir `lww` | `sync.md` §10 exige ambas filas y ADR 0006 asignó la detección/señal a la fase 3; sin `lww`, `teacher-service` (T10) no tiene soporte |
| Fijar el formato del token de versión en el kernel | Pre-diseñaría el modelo de datos de la vertical (ODD #3); ADR 0002 §4 lo deja explícitamente a la vertical |
| Llevar la señal de sobrescritura en un header de respuesta | Los headers HTTP no admiten bien texto no ASCII (`actor`/`deviceLabel` legibles): obligaría a codificar; el envelope en JSON es más simple y no toca el `data` |
| Exigir `baseVersion` en el body de cada entidad | Acoplaría el contrato de sync a la forma de cada payload; el header mantiene el cuerpo de la entidad limpio de metadatos de protocolo |
| Aplicar el TTL/LRU en el adaptador (`GetCacheStore`) | Repartiría la semántica §1.1 entre adaptadores, duplicándola por motor; el núcleo la centraliza y el adaptador solo persiste |
| Usar `setTimeout` global en el núcleo del cliente | Ataría el test a 20 s reales y el núcleo a un API de plataforma; el `Scheduler` inyectable lo hace determinista (D4) |
| Poner `kernel-conformance` dentro de otro paquete | §4 la nombra como paquete propio y es el artefacto de aceptación; meterla en `kernel-http` mezclaría el adaptador con su suite |
| Un agregado del kernel para probar la convergencia | Un agregado del kernel solo se admite con la segunda instancia (ODD #3, ADR 0005); la suite usa un agregado **de referencia** en tests, como la fase 2 |
