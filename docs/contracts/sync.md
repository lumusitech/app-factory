# Contrato de sync

> Documento normativo. Describe **qué** debe cumplir el protocolo de
> sincronización offline del kernel, no cómo implementarlo. Cualquier cliente o
> adaptador que lo respete es conforme; el código es una implementación de
> referencia.
>
> Entregable de la fase 0 ([`docs/kernel-context.md`](../kernel-context.md) §5.2 y
> §7). Elabora la semántica ya decidida en §1.1 ("Cola offline cliente",
> "Protocolo de replay"). Las decisiones **nuevas** que este contrato necesita
> quedan registradas en el [ADR 0002](../adr/0002-decisiones-contrato-sync.md);
> este documento las cita y no las duplica.

- **Estado:** propuesto (borrador para revisión de la fase 0)
- **Ámbito:** cola offline del cliente (`kernel-client`) y su contraparte
  servidor (`kernel-http`), consumibles por cualquier cliente (D14: una app
  Android debe poder implementarlo).
- **Decisiones relacionadas:** §1.1, §4, §5.2; D10, D14, D16, D22, D23, D25;
  [ADR 0002](../adr/0002-decisiones-contrato-sync.md).

---

## 1. Alcance y precondición

El protocolo aplica a una **mutación** (método `POST`, `PUT`, `PATCH` o
`DELETE`) que un cliente captura **sin conexión** y guarda en su cola local. Las
lecturas (`GET`, `HEAD`) quedan fuera: su semántica offline se resuelve con
caché, no con este contrato.

Una request entra a la cola si y solo si se cumplen **las dos** condiciones:

1. **Es una mutación** capturada offline (no hay conexión disponible, o el
   envío falló por causa de red, §4).
2. **Trae una `Idempotency-Key`** (§6). Sin key, la request no tiene protección
   de idempotencia en el servidor y **no** se encola.

El sync **no** reemplaza a la idempotencia: el reenvío de un item de la cola es
una mutación idempotente regida por el [contrato de idempotencia](idempotency.md)
(§5.1). Este contrato describe el **ciclo de vida del item en la cola** y la
**política de conflicto**; aquel describe la **semántica del servidor** ante una
mutación repetida.

### 1.1 Qué queda fuera

- **La mecánica del lado servidor ante una mutación repetida** (hash, TTL,
  replay, fail-open): es el contrato de idempotencia (§5.1).
- **La aplicación del alcance** (usuario/tenant): es el contrato de alcance
  (§5.3).
- **La forma del envelope y los códigos de error concretos**: viven en
  `kernel-contracts` (§4). Acá se referencian, no se redefinen.
- **La entrega proactiva a otros dispositivos** (push, auto-refresh, avisos
  entre dispositivos): es transporte de notificaciones, ajeno a este contrato
  (§11).
- **La implementación** de la cola y del flush: fase 3.

---

## 2. Modelo conceptual

| Término | Significado |
|---|---|
| **QueuedRequest** | Unidad de la cola offline (§7). Una mutación capturada, con su `Idempotency-Key`, su `order` FIFO y su `state`. |
| **Cola** | Secuencia ordenada de `QueuedRequest` no terminales (`pending` y `blocked`). |
| **Flush** | Proceso de recorrer la cola en orden FIFO e intentar enviar cada item (§5). |
| **`pending`** | Estado inicial. El item espera ser enviado. |
| **`blocked`** | Estado terminal-visible. El item no se reenvía solo; requiere intervención (§3, §4). Nunca se descarta en silencio. |
| **Replay** | Reenvío de un item de la cola. Se apoya en el contrato de idempotencia (§5.1) para no duplicar el efecto. |
| **Watchdog** | Temporizador que acota un intento de envío (§5). |
| **Conflicto** | Intento de aplicar una escritura sobre una versión **más nueva** de la entidad (§8). |
| **Token de versión** | Valor opaco y monótono por entidad, que el cliente envía para que el servidor detecte una escritura obsoleta (§8). |
| **Política de conflicto** | Forma explícita en que una vertical resuelve un conflicto: `blocked` o `lww` (§8). |

La cola es **FIFO estricto** (§5) y **nunca descarta datos del usuario en
silencio**: todo item termina en uno de dos finales observables — enviado
(`remove`) o `blocked` (visible).

---

## 3. Estados

Dos estados, y solo dos:

```
              captura offline
                    │
                    ▼
              ┌──────────┐
              │ pending  │
              └────┬─────┘
     2xx ──────────┤────────── 401 · 4xx ──────────┐
     (remove)      │                                │
                   └──── bloqueado ────► ┌──────────┐
                        (conservar y    │ blocked  │
                         cortar /        └──────────┘
                         watchdog)        intervención
                                          humana → reencolar
```

- **`pending`** — estado inicial de todo item encolado. Es el único estado que
  el flush intenta enviar.
- **`blocked`** — el item dejó de reintentarse automáticamente porque una
  intervención (re-autenticación, corrección, resolución de conflicto) es
  necesaria. **Es visible y nunca se descarta**: el usuario lo ve y decide.

No hay estados intermedios (`sending`, `retrying`): el intento en curso es un
detalle de implementación del flush, no un estado persistido del item.

---

## 4. Transiciones

El flush envía el item y clasifica la respuesta. La transición depende **solo**
del resultado observable:

| Resultado del envío | Transición | Razón |
|---|---|---|
| **`2xx`** | `pending → remove` | Aplicada (o replay idempotente de una ya aplicada, §5.1). El item se borra de la cola. |
| **`401`** | `pending → blocked` | Sesión inválida. Reintentar no ayuda hasta re-autenticar. El item queda visible. |
| **`4xx`** (excepto `401`) | `pending → blocked` | Error del cliente o conflicto (`409`): la request tal cual no se aplicará. Requiere corrección o resolución humana (§8). Visible, **nunca** se descarta. |
| **`5xx`** | `pending → pending` (conservar) | Fallo del servidor o transitorio. El item **se conserva** y el flush **se corta** (§5). |
| **Error de red** (timeout, conexión caída, respuesta truncada) | `pending → pending` (conservar) | Indeterminado: el efecto pudo o no haber ocurrido. El item **se conserva** y el flush **se corta**; el reenvío lo resuelve la idempotencia (§5.1). |
| **Watchdog vencido** | `pending → pending` (conservar) | El intento se aborta tras 20 s (§5). El item se conserva y el flush se corta. |

**Regla dura:** ante `5xx`, error de red o watchdog vencido, el flush **se
corta** (no sigue con el item siguiente). Continuar rompería el FIFO y el orden
de dependencias entre mutaciones.

Un item `blocked` **no** se reintenta automáticamente. Vuelve a `pending` solo
por una acción explícita (el usuario corrige y reencola, o re-autentica), que es
la "intervención" del diagrama de §3.

---

## 5. FIFO y watchdog

### 5.1 FIFO estricto

- La cola se recorre en **orden estricto** por el campo `order` (§7),
  ascendente.
- El flush procesa **un item a la vez**, en cabeza de cola. No hay envíos en
  paralelo ni reordenamiento.
- Si un item **corta** el flush (`5xx`, red, watchdog), los items posteriores
  **no** se envían en ese ciclo. El orden se preserva a costa de la latencia.
- Un item `blocked` en la cabeza **detiene** el procesamiento automático de los
  posteriores: es deliberado (head-of-line), porque una mutación bloqueada
  suele preceder a sus dependientes.

### 5.2 Watchdog

- Cada intento de envío está acotado por un **watchdog de 20 s**. Es el de §1.1
  y no se re-litiga.
- Si el watchdog vence sin respuesta terminal, el intento se **aborta**; el item
  se **conserva** en `pending` y el flush **se corta** (§4).
- El watchdog mide **un intento**, no la request total: se reinicia en cada
  reintento.

---

## 6. Headers de replay

Los tres headers son de §1.1 y pertenecen a `kernel-contracts` (§4). Se
describen en el [contrato de idempotencia](idempotency.md) §9 y se citan acá
porque el reenvío de la cola los usa:

| Header | Dirección | Semántica en el replay |
|---|---|---|
| `Idempotency-Key` | request | Identifica la operación lógica. **Requerido** para encolar (§1). Viaja igual en cada reintento para que el servidor reconozca el duplicado. |
| `X-Offline-Replay` | request | Marca que la request proviene de la cola offline y no es una acción nueva. Es una señal de origen; no altera la idempotencia. |
| `X-Connectivity-Probe` | request | Bypass explícito de la idempotencia para endpoints de *probe*. **Las requests de probe no se encolan.** |

El probe (`X-Connectivity-Probe: true`) sirve para decidir **cuándo** disparar el
flush; su resultado no crea ni modifica items de la cola.

---

## 7. `QueuedRequest` JSON Schema (normativo)

Forma normativa de la unidad de la cola. Se extrae a `kernel-contracts` en la
fase 1; hasta entonces vive acá. Un cliente es conforme si produce objetos que
validan contra este schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://app-factory.dev/kernel/contracts/queued-request.schema.json",
  "title": "QueuedRequest",
  "description": "Unidad de la cola offline del cliente. Se extrae a kernel-contracts en la fase 1.",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "order", "method", "path", "idempotencyKey", "state", "createdAt", "attempts"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Identificador local del item en la cola (UUIDv7)."
    },
    "order": {
      "type": "integer",
      "minimum": 0,
      "description": "Secuencia FIFO de encolado. Estrictamente creciente dentro de un cliente."
    },
    "method": {
      "type": "string",
      "enum": ["POST", "PUT", "PATCH", "DELETE"],
      "description": "Método HTTP de la mutación."
    },
    "path": {
      "type": "string",
      "description": "Ruta enrutada de destino, sin query string."
    },
    "body": {
      "type": ["object", "null"],
      "description": "Cuerpo de la request. Null cuando la mutación no lleva cuerpo (p. ej. DELETE)."
    },
    "idempotencyKey": {
      "type": "string",
      "description": "Valor del header Idempotency-Key (§6). Único por operación lógica."
    },
    "baseVersion": {
      "type": ["string", "null"],
      "description": "Token de versión de la entidad al momento de la captura (§8). Null si la operación no versiona."
    },
    "state": {
      "type": "string",
      "enum": ["pending", "blocked"],
      "description": "Estado del item en la cola (§3)."
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "Instante de encolado (ISO 8601)."
    },
    "attempts": {
      "type": "integer",
      "minimum": 0,
      "description": "Cantidad de intentos de envío realizados."
    },
    "lastAttemptAt": {
      "type": ["string", "null"],
      "format": "date-time",
      "description": "Instante del último intento, o null si nunca se intentó."
    },
    "blockedReason": {
      "type": ["object", "null"],
      "description": "Motivo del bloqueo. No null si y solo si state = blocked.",
      "additionalProperties": false,
      "required": ["statusCode", "message"],
      "properties": {
        "statusCode": { "type": "integer" },
        "message": { "type": "string" },
        "error": { "type": ["string", "null"] }
      }
    }
  }
}
```

---

## 8. Política de conflicto

**Decisión explícita: el kernel no mergea.** Ante una escritura obsoleta —una
mutación que se aplicaría sobre una versión **más nueva** de la entidad— el
kernel **detecta el conflicto** y lo resuelve según la **política explícita de
la vertical**. Nunca en silencio. Esto es una decisión, no una carencia
(§5.2; [ADR 0002](../adr/0002-decisiones-contrato-sync.md)).

### 8.1 Detección

- Cada entidad versionable expone un **token de versión** opaco y monótono. El
  cliente lo envía por request (`baseVersion`, §7); el servidor lo contrasta
  contra la versión vigente.
- Si `baseVersion` **coincide** con la vigente, no hay conflicto: la mutación se
  aplica y la versión avanza.
- Si `baseVersion` es **anterior** a la vigente, hay conflicto: el servidor **no
  aplica** la escritura por su cuenta y actúa según la política.
- Este contrato **no fija el formato** del token (`updatedAt`, entero monótono,
  ETag): exige que sea opaco, monótono y por entidad. Elegir el formato es
  decisión de la vertical, con su propio ADR (implica su modelo de datos).

### 8.2 Las dos políticas

| Política | Ante un conflicto | Transición del item |
|---|---|---|
| **`blocked`** (por defecto) | El servidor responde **`409`**. La escritura **no** se aplica; **una persona resuelve**. El conflicto queda visible. | `pending → blocked` (§4) |
| **`lww`** | El servidor **aplica la última escritura** (la entrante) y **señala** que sobrescribió una versión más nueva. La UI advierte. | `pending → remove` (con aviso) |

- **`blocked` es el default del kernel.** Si una vertical no declara política, se
  comporta como `blocked`. Resolver un conflicto es siempre **explícito**.
- **`lww` nunca es silencioso.** El servidor devuelve una **señal de
  sobrescritura** —mínimo: versión previa, actor, etiqueta legible de
  dispositivo/sesión y timestamp— y **la UI debe advertir** que se pisó una
  versión más nueva. La etiqueta de dispositivo y el actor los deriva el
  **servidor**; no se confía en lo que declare el cliente. La IP **no** es un
  campo por defecto (poco fiable y sensible).

### 8.3 Casos del portafolio

| Producto | Política | Por qué |
|---|---|---|
| **`teacher-service`** | `lww` | Un solo escritor por tenant; el único conflicto posible es el mismo docente en dos dispositivos. Última escritura gana, con aviso (T10). |
| **`store-service`** | `blocked` | El inventario y la venta exigen resolución explícita; pisar stock en silencio es inaceptable. |

La política es **por vertical** (y por entidad si hiciera falta): vive en la
vertical, no en el kernel (§2).

---

## 9. Envelope y errores

Este contrato **no** redefine el transporte. El envelope exitoso
`{statusCode, data, timestamp}`, el de error `{statusCode, message, error,
timestamp}` y el catálogo de códigos viven en `kernel-contracts` (§1.1, §4). Acá
solo se fijan los **códigos de estado** que gobiernan las transiciones de la
cola: `2xx` (aplicada/replay), `401` (sesión inválida), `4xx` (error del cliente
o conflicto), `5xx` (transitorio) y el **`409`** del conflicto `blocked` (§8.2).
El nombre exacto del código de conflicto se define en `kernel-contracts`.

---

## 10. Pruebas de conformidad

`kernel-conformance` (§4, fase 3) debe cubrir, como mínimo, **bordes y rutas
críticas** (D22, CONTRIBUTING §8): el camino feliz no cuenta.

| Escenario | Qué se verifica |
|---|---|
| Crear offline → reconectar → sincronizar | Converge sin duplicar (el test de aceptación del kernel, §7) |
| `2xx` | El item se borra de la cola |
| `401` | El item queda `blocked`, visible, no se descarta |
| `4xx` (no `401`) | El item queda `blocked`, visible |
| `5xx` | El item se conserva y el flush **se corta** |
| Error de red / timeout | El item se conserva y el flush **se corta** |
| Watchdog (20 s) | El intento se aborta; el item se conserva; el flush se corta |
| FIFO | Los items se envían en orden; un corte no reordena |
| Head-of-line | Un `blocked` en cabeza detiene el flush automático |
| Probe | `X-Connectivity-Probe` no encola ni modifica la cola |
| Conflicto `blocked` | `409`; item `blocked`; no se aplica la escritura |
| Conflicto `lww` | Con token obsoleto, la última escritura se aplica, el item se borra y llega la señal de sobrescritura (versión previa, actor, dispositivo) |
| `baseVersion` coincidente | Sin conflicto; la mutación se aplica |
| `QueuedRequest` | Un item típico valida contra el schema de §7 |
| Multi-dispositivo `lww` | Tras una sobrescritura, la UI del escritor muestra el aviso |

---

## 11. Fuera de alcance / "esto no se extrae y por qué"

- **No** se extrae el merge de conflictos: el kernel **no mergea** (§5.2, §8).
  El conflicto es terminal y explícito (`blocked`) o resuelto por política
  (`lww`); **no** hay combinación automática de versiones.
- **No** se extrae la resolución aceptar/rechazar entre dispositivos (un
  dispositivo propone y otro acepta/rechaza, con bucle hasta decisión terminal):
  es un workflow con estado durable, presencia y transporte push. Con n=1 (solo
  `teacher-service`) está prohibido generalizarlo (§2, D18, ODD #3). Se registra
  como candidato a validar con la segunda vertical.
- **No** se extrae la **entrega proactiva a otros dispositivos** (WebSocket/SSE/
  polling, toast o auto-refresh): es **transporte de notificaciones** (§1.4), no
  el protocolo de la cola. Contrato aparte cuando exista. `lww` garantiza la
  **señal**, no la entrega.
- **No** se define el almacenamiento concreto de la cola (IndexedDB u otro): es
  un adaptador; el contrato solo exige persistencia local con `order` y `state`.
- **No** se fija el formato del token de versión (§8.1): es decisión de la
  vertical.
- **No** se incluye el hash/TTL/replay del servidor: es el contrato de
  idempotencia (§5.1).

---

## 12. Referencias

- [`docs/kernel-context.md`](../kernel-context.md) — §1.1 (cola offline y
  protocolo de replay), §4 (`kernel-contracts` / `kernel-client`), §5.2 (este
  contrato), §6 (prohibiciones duras).
- [`docs/contracts/idempotency.md`](idempotency.md) — §5.1; el reenvío de la cola
  es una mutación idempotente.
- [`docs/adr/0002-decisiones-contrato-sync.md`](../adr/0002-decisiones-contrato-sync.md)
  — política de conflicto, watchdog, `QueuedRequest` y frontera con el transporte
  de notificaciones.
- Decisiones: D10, D14, D16, D22, D23, D25.
