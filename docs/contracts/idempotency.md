# Contrato de idempotencia

> Documento normativo. Describe **qué** debe cumplir la idempotencia de
> mutaciones en el kernel, no cómo implementarla. Cualquier cliente o adaptador
> que lo respete es conforme; el código es una implementación de referencia.
>
> Entregable de la fase 0 ([`docs/kernel-context.md`](../kernel-context.md) §5.1 y
> §7). Elabora la semántica ya decidida en §1.1 ("Idempotencia servidor" y
> "Protocolo de replay"). Las decisiones **nuevas** que este contrato necesita
> quedan registradas en el [ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md);
> este documento las cita y no las duplica.

- **Estado:** propuesto (borrador para revisión de la fase 0)
- **Ámbito:** mutaciones HTTP del kernel (`kernel-http`), consumibles por
  cualquier cliente.
- **Decisiones relacionadas:** §1.1, §4, §5.1; D12, D14, D16, D22, D23, D25;
  [ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md).

---

## 1. Alcance y precondición

La idempotencia aplica a una request si y solo si se cumplen **las tres**
condiciones:

1. **Es una mutación** — método `POST`, `PUT`, `PATCH` o `DELETE`. Las lecturas
   (`GET`, `HEAD`) quedan fuera: su repetibilidad se resuelve con caché, no con
   este contrato.
2. **Trae el header `Idempotency-Key`** (§9). Sin header, la request se ejecuta
   sin protección de idempotencia.
3. **El usuario está autenticado.** Sin identidad no hay clave de hash posible
   (§3) y la request no entra al mecanismo.

Si falta cualquiera de las tres, la request **no** es idempotente bajo este
contrato: se procesa con el comportamiento normal y no se registra nada.

### 1.1 Qué queda fuera

- **El protocolo de sync** (`pending`/`blocked`, transiciones, FIFO, watchdog):
  es el contrato de sync (§5.2). Este documento solo define la semántica del
  lado servidor para una mutación repetida.
- **La aplicación del alcance** (usuario/tenant): es el contrato de alcance
  (§5.3).
- **La forma del envelope y los códigos de error concretos**: viven en
  `kernel-contracts` (§4). Acá se referencian, no se redefinen.
- **La implementación** del interceptor: fase 2.

---

## 2. Modelo conceptual

| Término | Significado |
|---|---|
| **Key** | Valor del header `Idempotency-Key`. Lo elige el cliente y debe ser único por operación lógica. |
| **Fingerprint** | Huella de la request que distingue un payload de otro (§7). |
| **Hash / clave** | `SHA-256(userId \| method \| path \| key)` (§3). Identifica el registro en el store. |
| **Registro** | Lo que se guarda tras ejecutar: `{key, fingerprint, statusCode, body, createdAt, expiresAt}` (§5). |
| **Replay** | Devolver la respuesta almacenada de una request ya aplicada, **sin** ejecutar el handler (§5). |
| **Ventana** | Los 48 h durante los cuales un registro habilita replay (§4). |

El mecanismo es **una máquina de dos resultados por clave**: *replay* (ya la vi)
o *ejecución* (nunca la vi). El cliente reenvía con la **misma** key cuando no
pudo confirmar el resultado; el servidor decide con el registro.

---

## 3. Clave de hash

La clave del registro se calcula así:

```
hash = SHA-256(userId | method | path | key)
```

donde:

- `userId` — identidad del usuario autenticado (precondición §1).
- `method` — método HTTP en **mayúsculas** (`POST`, `PATCH`, …).
- `path` — la **ruta enrutada**, sin query string.
- `key` — el valor del header `Idempotency-Key`, recortado de espacios en los
  extremos.
- El separador es `|`. La salida se serializa en **hex minúscula**.

La composición es **verbatim** de §1.1. La normalización de `method`, `path` y
`key` es la del [ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md)
§Decisión punto 5.

> **Supuesto y limitación — tenant.** La clave usa **solo** `userId`, no el
> tenant. Bajo el portafolio actual el tenant es **plano** (D25) y el supuesto se
> sostiene. Si un mismo usuario perteneciera a dos tenants y reenviara el mismo
> `path` + `key`, las claves podrían colisionar y devolver una respuesta ajena.
> Se documenta como limitación explícita y **no** se pre-diseña la dimensión
> tenant (ODD #3); se reevalúa con el test de §2 si un producto la exige.

---

## 4. Ventana de idempotencia (TTL 48 h)

- Un registro vive **48 horas** desde su `createdAt`.
- Dentro de la ventana, una request con la misma clave es **replay** (§5).
- Vencida la ventana, el registro se considera inexistente: la misma key se
  trata como nueva y **vuelve a ejecutar**. El TTL **no** es una garantía de
  unicidad permanente; es la ventana operativa en la que se reconoce un
  reintento.
- El valor 48 h es el de §1.1 y no se re-litiga.

---

## 5. Semántica de replay

Ante un *hit* en el store, el servidor devuelve el `statusCode` y el `body`
**almacenados, verbatim**:

- **No** vuelve a ejecutar el handler.
- **No** re-aplica la mutación (ni efectos, ni outbox, ni eventos).
- El registro almacenado es `{key, fingerprint, statusCode, body, createdAt,
  expiresAt}` y el replay usa `statusCode` + `body`.
- Si el replay corresponde a la misma key pero **distinto** payload, no hay
  replay: es el caso de conflicto de §7.

Esto es lo que hace converger a un cliente offline: reenviar tras una
reconexión no duplica el efecto, devuelve el mismo resultado.

---

## 6. Concurrencia

Dos requests con la **misma clave** en vuelo:

- La primera **ejecuta**.
- La segunda se rechaza con **`409`** y un código de conflicto; **no** se
  ejecuta.

Detalle y alternativas descartadas: [ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md).

---

## 7. Reuso de la key con payload distinto

La idempotencia **nunca** devuelve la respuesta de un payload distinto. Si la
key ya existe en la ventana pero el **fingerprint** de la request entrante no
coincide con el registrado, se responde **`409`** con un código de conflicto.
Es un error del cliente: la key debe ser única por operación lógica.

---

## 8. Comportamiento ante fallo del store

**Fail-open.** Si el store falla, la mutación **no** se bloquea y **no** se
responde `5xx` por causa del store:

- **Fallo de lectura:** se trata como *miss* → se ejecuta el handler. Se pierde
  la protección contra duplicados mientras dure el fallo, no la disponibilidad.
- **Fallo de escritura (post-ejecución):** la mutación **ya se aplicó** y su
  respuesta es la legítima; el fallo de guardado se registra (log) y no cambia
  el resultado para el cliente.

El fail-open es el comportamiento de §1.1. Su consecuencia —la ventana
ejecución→guardado no protegida— es la decisión de crash-safety del
[ADR 0001](../adr/0001-decisiones-contrato-idempotencia.md).

---

## 9. Headers

| Header | Dirección | Quién lo envía | Semántica |
|---|---|---|---|
| `Idempotency-Key` | request | cliente | Clave de idempotencia de la operación lógica. **Requerido** en mutaciones que quieran protección (§1). Su valor entra al hash (§3). |
| `X-Offline-Replay` | request | cliente (cola offline) | Marca que la request es un **replay** de la cola offline, no una acción nueva. Es una señal de origen del cliente; no altera la clave ni la semántica de replay del servidor. |
| `X-Connectivity-Probe` | request | cliente | **Bypass explícito**: si vale `true`, la request salta el mecanismo de idempotencia por completo (ni lee ni escribe el store). Reservado a endpoints de *probe* (§ADR 0001 punto 6). |

`Idempotency-Key` y `X-Offline-Replay` son los de §1.1; el bypass
`X-Connectivity-Probe` también. Los tres headers pertenecen a
`kernel-contracts` (§4).

---

## 10. Envelope y errores

Este contrato **no** redefine el transporte. El envelope exitoso
`{statusCode, data, timestamp}`, el de error `{statusCode, message, error,
timestamp}` y el catálogo de códigos viven en `kernel-contracts` (§1.1, §4). Acá
solo se fijan los **códigos de estado** propios de la idempotencia: `409` en los
casos de §6 y §7. El nombre exacto del código de conflicto se define en
`kernel-contracts`, no acá.

---

## 11. Pruebas de conformidad

`kernel-conformance` (§4, fase 3) debe cubrir, como mínimo, **bordes y rutas
críticas** (D22, CONTRIBUTING §8): el camino feliz no cuenta.

| Escenario | Qué se verifica |
|---|---|
| Replay de una mutación ya aplicada | Misma respuesta almacenada; el efecto **no** se repite |
| Doble envío de la misma key | Un solo efecto; segunda request = replay |
| Key en vuelo (concurrencia) | Segunda request → `409`; no ejecuta |
| Misma key, payload distinto | `409`; no devuelve la respuesta ajena |
| Expiración a las 48 h | Pasada la ventana, la misma key vuelve a ejecutar |
| Fallo de lectura del store | Fail-open; la mutación se ejecuta |
| Fallo de escritura del store | La mutación responde OK; se registra el fallo |
| `X-Connectivity-Probe: true` | No toca el store |
| `method`/`path`/`key` normalizados | La clave colisiona o difiere según §3 |

---

## 12. Fuera de alcance / "esto no se extrae y por qué"

- **No** se extrae el motor offline del cliente (`kernel-client`): vive en su
  contrato de sync (§5.2).
- **No** se define el almacenamiento concreto del store (Redis, tabla, etc.): es
  un adaptador; el contrato solo exige lectura/escritura por clave con TTL.
- **No** se incluye merge de conflictos: el conflicto es terminal (`409`); su
  resolución es humana, y eso es una decisión del contrato de sync (§5.2), no
  una carencia.
- **No** se añade jerarquía de tenant a la clave (§3): no hay consumidor real
  (ODD #1, D25).

---

## 13. Referencias

- [`docs/kernel-context.md`](../kernel-context.md) — §1.1 (idempotencia y
  protocolo de replay), §4 (`kernel-contracts`), §5.1 (este contrato), §6
  (prohibiciones duras).
- [`docs/adr/0001-decisiones-contrato-idempotencia.md`](../adr/0001-decisiones-contrato-idempotencia.md)
  — decisiones de crash-safety, concurrencia, reuso de key, registro/replay,
  normalización y bypass.
- Decisiones: D12, D14, D16, D22, D23, D25.
