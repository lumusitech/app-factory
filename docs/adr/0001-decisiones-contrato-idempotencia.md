# 0001 — Decisiones del contrato de idempotencia

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.1 ("Idempotencia servidor" y
  "Protocolo de replay"), §4, §5.1; D12, D14, D16, D22, D23, D25;
  `docs/contracts/idempotency.md`; PR #7.

## Contexto

La fase 0 tiene como segundo entregable los contratos de
[`docs/kernel-context.md`](../kernel-context.md) §5. El §5.1 manda el **contrato
de idempotencia** con un alcance ya fijado: precondición (mutación + header +
usuario autenticado), clave de hash, TTL, semántica de replay y comportamiento
ante fallo del store.

Buena parte de esa semántica **ya está decidida** y no se re-litiga: la tabla
§1.1 registra que el servidor usa un interceptor global en mutaciones, con hash
`SHA-256(userId|method|path|key)`, TTL de 48 horas, replay que devuelve la
respuesta almacenada sin re-ejecutar y **fail-open** si el store falla. El §1.1
también fija los headers `Idempotency-Key` y `X-Offline-Replay`, y el bypass
explícito `X-Connectivity-Probe`; el §4 asigna esos tres headers a
`kernel-contracts`.

Al escribir el contrato (§5.1) aparecen **seis puntos que ninguna decisión `D*`
ni el §1.1 resuelven**, y que el contrato necesita cerrar para ser
implementable:

1. qué se hace entre la ejecución y el guardado del registro (crash-safety);
2. qué ocurre con dos requests de la misma key en vuelo (concurrencia);
3. qué ocurre si se reusa la key con un payload distinto;
4. qué forma tiene el registro almacenado y qué devuelve el replay;
5. cómo se normalizan `method` y `path` antes del hash;
6. hasta dónde llega el bypass `X-Connectivity-Probe`.

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un
evento explícito (ADR)") y el disparador de
[`docs/adr/README.md`](README.md) ("se introduce … un contrato nuevo"). **No
duplica** lo que ya vive en §1.1/§5.1: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para el contrato de idempotencia. Todas
operan dentro de la ventana de TTL de 48 h y solo sobre mutaciones que cumplan
la precondición del contrato.

1. **Crash-safety — `execute-then-store`.** El interceptor primero consulta el
   store: *hit* → replay de la respuesta almacenada; *miss* → ejecuta el handler
   y **luego** guarda el registro. La garantía es *at-most-once* **mientras el
   registro exista**; la ventana entre la ejecución y el guardado queda
   documentada como no protegida (un crash en ese tramo permite una segunda
   ejecución en el reintento). Se prefiere esta forma porque preserva el
   fail-open: si el store está caído, la mutación no se bloquea.
2. **Concurrencia — `409`.** Una segunda request con la misma key recibida
   mientras la primera está en vuelo se rechaza con `409` y un código de
   conflicto; no se ejecuta.
3. **Reuso de key con payload distinto — `409`.** Si el fingerprint de la
   request entrante no coincide con el registrado para esa key, se responde
   `409`. La idempotencia nunca devuelve la respuesta de un payload distinto.
4. **Registro y replay.** El registro almacena
   `{key, fingerprint, statusCode, body, createdAt, expiresAt}`. El replay
   devuelve el `statusCode` y el `body` almacenados **verbatim**, sin ejecutar el
   handler ni re-aplicar la mutación.
5. **Normalización del hash.** La clave es `SHA-256(userId|method|path|key)` con:
   `method` en mayúsculas; `path` como la ruta enrutada **sin** query string;
   `key` el valor del header recortado de espacios en los extremos; salida en
   **hex minúscula**. Se mantiene la composición **verbatim** de §1.1 (ver
   consecuencias).
6. **Bypass `X-Connectivity-Probe`.** Cuando vale `true`, el interceptor salta
   por completo: ni lee ni escribe el store. Solo se honra en endpoints de
   probe. Que la request de probe no se encole es responsabilidad del contrato de
   sync (§5.2), no de este.

## Consecuencias

- **Se gana** previsibilidad del replay (misma respuesta, sin re-ejecución),
  comportamiento no bloqueante ante caída del store (fail-open) y un conflicto
  explícito y observable cuando la misma key se reusa con otro payload.
- **Se paga** una garantía *at-most-once* acotada a la existencia del registro:
  la ventana ejecución→guardado (punto 1) puede permitir una doble ejecución ante
  un crash. Se acepta a cambio de no introducir un estado *pending* ni una
  transacción distribuida, que el kernel no necesita en esta fase.
- **Supuesto y limitación — tenant.** El hash usa solo `userId`, como §1.1. Bajo
  multi-tenancy real (D12/D16) con un mismo usuario en dos tenants, dos requests
  con igual `path` y `key` podrían colisionar y devolver una respuesta ajena. Hoy
  el portafolio tiene **tenant plano** (D25) y el supuesto se sostiene; se
  documenta como limitación explícita y **no se pre-diseña** la dimensión tenant
  en la clave (ODD #3). Se reevalúa con el test de §2 solo si un producto la
  exige.
- **Fuera de alcance:** el merge de sync y sus estados (§5.2); el contrato de
  alcance (§5.3); el catálogo concreto de códigos de error (vive en
  `kernel-contracts`, §4); la implementación del interceptor (fase 2).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| `record-then-execute` (insertar un *pending* antes de ejecutar) | Cierra la ventana de crash, pero introduce un estado *pending*, su expiración y su reconciliación, y complica el fail-open. Ceremonia que el kernel no necesita ahora (ODD #1, §2) |
| Segunda request en vuelo esperando en vez de `409` | Serializa y oculta el conflicto; `409` es observable y no añade estado de espera |
| Devolver la respuesta almacenada ante payload distinto | Violaría la semántica —"misma request, misma respuesta"— y enmascararía un bug del cliente |
| Incluir el tenant/alcance en la clave de hash | Matizaría §1.1 y pre-diseñaría para un caso (usuario en varios tenants) que ninguna de las tres verticales tiene hoy (D25, ODD #3). Queda como limitación documentada, no como decisión |
| `425 Too Early` para la concurrencia | Añade un código que los clientes del portafolio no necesitan distinguir; `409` cubre ambos conflictos con una sola semántica |
