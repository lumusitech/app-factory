# Protocolo de sync (paquete)

> Documento **empaquetado** para quien implementa un cliente del kernel (web,
> Android/Jetpack Compose, etc.). La fuente **normativa** del protocolo es
> [`docs/contracts/sync.md`](../../../docs/contracts/sync.md) del monorepo; este
> archivo la **cita y resume** para distribuirse junto al JSON Schema, sin
> redefinirla. Ante cualquier discrepancia, gana el contrato normativo.

- **Ámbito:** cola offline del cliente y su contraparte servidor.
- **Normativo:** `docs/contracts/sync.md` (§3 estados, §4 transiciones, §5 FIFO y
  watchdog, §6 headers, §7 `QueuedRequest`, §8 política de conflicto).
- **Schema:** [`queued-request.schema.json`](./queued-request.schema.json)
  (JSON Schema draft 2020-12, normativo).

## 1. Precondición de encolado

Una request entra a la cola si y solo si es una **mutación** (`POST`, `PUT`,
`PATCH`, `DELETE`) capturada offline y trae una **`Idempotency-Key`**. El reenvío
de un item es una mutación idempotente: la semántica del servidor ante una
mutación repetida vive en el contrato de idempotencia (§5.1 del contexto).

## 2. Estados

Dos, y solo dos:

- **`pending`** — estado inicial; es el único que el flush intenta enviar.
- **`blocked`** — terminal-visible; nunca se descarta en silencio. Requiere
  intervención (re-autenticación, corrección o resolución de conflicto) para
  volver a `pending`.

No hay estados intermedios (`sending`, `retrying`): el intento en curso es
detalle de implementación.

## 3. Transiciones

| Resultado del envío | Transición | Flush |
|---|---|---|
| `2xx` | `pending → remove` | continúa |
| `401` | `pending → blocked` | continúa |
| `4xx` (excepto `401`, incluido `409`) | `pending → blocked` | continúa |
| `5xx` | `pending → pending` (conservar) | **corta** |
| Error de red (timeout, caída, respuesta truncada) | `pending → pending` (conservar) | **corta** |
| Watchdog vencido (20 s) | `pending → pending` (conservar) | **corta** |

**Regla dura:** ante `5xx`, error de red o watchdog vencido, el flush **se corta**;
continuar rompería el FIFO. Un item `blocked` en la cabeza detiene el
procesamiento automático (head-of-line).

## 4. FIFO y watchdog

Recorrido en **orden estricto** por el campo `order` ascendente, **un item a la
vez**, sin envíos en paralelo. Cada intento está acotado por un **watchdog de
20 s** que se reinicia en cada reintento.

## 5. Headers

| Header | Dirección | Semántica |
|---|---|---|
| `Idempotency-Key` | request | Identifica la operación lógica. Requerido para encolar. |
| `X-Offline-Replay` | request | El reenvío proviene de la cola offline, no es una acción nueva. |
| `X-Connectivity-Probe` | request | `true` = bypass de idempotencia para probe. **No** se encola. |

## 6. Política de conflicto

El kernel **no mergea**: detecta la escritura obsoleta y la resuelve según la
política explícita de la vertical, nunca en silencio.

- **`blocked`** (default): el servidor responde `409`; una persona resuelve.
- **`lww`**: se aplica la última escritura y el servidor devuelve una **señal de
  sobrescritura** (versión previa, actor, etiqueta de dispositivo, timestamp); la
  UI advierte. Nunca silenciosa.

## 7. Portabilidad

El protocolo es **documento + JSON Schema** (no código de un framework): un
cliente Android o cualquier otro puede implementarlo validando contra
`queued-request.schema.json` y respetando las transiciones de §3.
