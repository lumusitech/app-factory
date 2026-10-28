# 0002 — Decisiones del contrato de sync

- **Estado:** propuesto
- **Fecha:** 2026-10-28
- **Supersede a:** ninguno
- **Relacionado con:** `docs/kernel-context.md` §1.1 ("Cola offline cliente" y
  "Protocolo de replay"), §4, §5.2; D10, D14, D16, D22, D23, D25;
  `docs/contracts/sync.md`; `docs/teacher-service-context.md` T10.

## Contexto

La fase 0 tiene como segundo entregable los contratos de
[`docs/kernel-context.md`](../kernel-context.md) §5. El §5.2 manda el **contrato
de sync** con un alcance ya fijado: estados `pending`/`blocked`; transiciones
`2xx→remove`, `401→blocked`, `4xx→blocked`, `5xx/red→conservar y cortar`; FIFO;
watchdog; headers de replay.

Buena parte de esa semántica **ya está decidida** y no se re-litiga: la tabla
§1.1 registra la cola offline con estados `pending`/`blocked`, replay FIFO,
`2xx→borra`, `401→blocked`, `4xx→blocked` (visible, nunca se descarta), `5xx`/red
→ se conserva y corta, y un watchdog de 20 s. El §1.1 también fija los headers de
replay (`Idempotency-Key`, `X-Offline-Replay`, bypass `X-Connectivity-Probe`), y
el §4 asigna esos headers y el `QueuedRequest` JSON Schema a `kernel-contracts`.

Al escribir el contrato (§5.2) aparecen **puntos que ninguna decisión `D*` resuelve
del todo**, y que el contrato necesita cerrar para ser implementable:

1. **La política de conflicto.** El §5.2 dice "no hay merge: conflicto =
   `blocked` + resolución humana", es decir, una **política única**. Pero
   `teacher-service` es **mono-escritor por tenant** y su `T10` fija
   "conflicto = última escritura gana" (`lww`). Hay una **tensión** entre §5.2
   (blocked) y T10 (lww). Además, `store-service` (inventario/venta) sí exige
   resolución explícita.
2. **La forma del item encolado** (`QueuedRequest`), que §4 anticipa pero no
   define.
3. **La detección de una escritura obsoleta** y la señal correspondiente: qué
   necesita `lww` para saber que pisó una versión más nueva.
4. **Qué hace el watchdog** al vencer: ¿bloquea el item o solo corta el flush?
5. **La frontera con la entrega a otros dispositivos** (push, auto-refresh,
   avisos multi-dispositivo).

Este ADR es el evento explícito que exige D23.2 ("cambiar el contrato es un
evento explícito (ADR)") y el disparador de [`docs/adr/README.md`](README.md)
("se introduce … un contrato nuevo"). **No duplica** lo que ya vive en
§1.1/§5.2: solo fija lo que aún no está decidido.

## Decisión

Se adoptan las siguientes resoluciones para el contrato de sync.

1. **El kernel no mergea.** Ante una escritura obsoleta, el kernel **detecta el
   conflicto** y lo resuelve según la **política explícita de la vertical**,
   nunca en silencio. Esto mantiene el "no hay merge" de §5.2 y lo vuelve
   configurable en vez de único.
2. **Política `blocked` por defecto.** Es el comportamiento del kernel si la
   vertical no declara política: el servidor responde **`409`**, la escritura no
   se aplica y **una persona resuelve**. El item queda visible, nunca se
   descarta.
3. **Política `lww` opt-in.** Cuando la vertical la declara, el servidor
   **aplica la última escritura** y devuelve una **señal de sobrescritura** que
   incluye, como mínimo: versión previa, actor, etiqueta legible de
   dispositivo/sesión (derivada por el servidor) y timestamp. La UI **advierte**.
   `lww` **nunca** es silencioso.
4. **Detección por token de versión.** Cada entidad versionable expone un token
   **opaco y monótono**; el cliente lo envía (`baseVersion`) y el servidor
   contrasta contra la versión vigente. Este ADR **no fija el formato** del token
   (decisión de la vertical). Enviar la escritura obsoleta no la aplica por
   cuenta del kernel: la resuelve la política.
5. **Watchdog = conservar y cortar.** Si el watchdog (20 s, §1.1) vence, el
   intento se aborta, el item **se conserva** en `pending` y el flush **se
   corta**. El watchdog **no** marca `blocked`.
6. **`QueuedRequest` normativo.** La unidad de la cola se define por el JSON
   Schema de `docs/contracts/sync.md` §7, a extraerse a `kernel-contracts` en la
   fase 1.
7. **Frontera con el transporte.** La **detección y la señal** del conflicto
   viven en el kernel (`sync`); la **entrega proactiva a otros dispositivos**
   (push/auto-refresh/avisos) **no** forma parte de este contrato: es transporte
   de notificaciones (§1.4), a contratar aparte.
8. **Aceptar/rechazar entre dispositivos: fuera de alcance.** Un modelo donde un
   dispositivo propone y otro acepta/rechaza, con bucle hasta decisión terminal,
   **se descarta** para este contrato (ver alternativas).

## Consecuencias

- **Se gana** un conflicto que nunca es silencioso y una política **explícita por
  vertical** en lugar de una única: `teacher-service` mantiene `lww` (T10) y
  `store-service` usa `blocked`, sin forzar a ninguna de las dos.
- **Se gana** un cliente **portable** (D14): el `QueuedRequest` y las
  transiciones son un documento + JSON Schema, implementable por una app Android.
- **Se paga** una implicación de **modelo de datos**: `lww` exige un token de
  versión por entidad. Eso es decisión de la vertical y disparará **su propio
  ADR** cuando `teacher-service` la implemente (CONTRIBUTING §6: "si toqué el
  modelo de datos, paré y propuse un ADR").
- **Se paga** que un item `blocked` en cabeza **detiene** el flush automático
  (head-of-line): es deliberado, pero puede retener items posteriores hasta la
  intervención humana.
- **Fuera de alcance:** el merge de conflictos (§5.2); la entrega proactiva
  cross-device y el modelo aceptar/rechazar; la resolución aceptar/rechazar; el
  contrato de alcance (§5.3); el catálogo concreto de códigos de error
  (`kernel-contracts`, §4); la implementación de la cola y del flush (fase 3); el
  formato del token de versión.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| `blocked` único (sin `lww`), como decía §5.2 | Contradice T10: `teacher-service` es mono-escritor y forzaría resolución humana donde no hay conflicto real. La tensión §5.2/T10 se resuelve volviendo la política configurable |
| `lww` único (sin `blocked`) | `store-service` necesita resolución explícita; perdería escrituras en silencio, justo lo que §5.2 prohíbe |
| `lww` silencioso (sin señal) | Viola "nunca silenciosa": el usuario pisaría una versión más nueva sin enterarse |
| Merge automático de versiones | Prohibido por §5.2 ("no hay merge") y contradice ODD: combinar versiones sin criterio de dominio es adivinar |
| Aceptar/rechazar entre dispositivos (con bucle hasta decisión terminal) | Es un workflow con estado durable, presencia y transporte push; con **n=1** (solo `teacher-service`) generalizarlo está prohibido (§2, D18, ODD #3). Además re-litigaría T10. Queda como candidato para la segunda vertical |
| Empujar el aviso por push desde el propio contrato de sync | Acopla el transporte de notificaciones al protocolo de la cola. `lww` debe garantizar la **señal**, no la entrega; el transporte es un contrato aparte (§1.4) |
| Watchdog que marca `blocked` | Un timeout es transitorio o indeterminado, no un error del cliente: bloquear exigiría intervención humana por un corte de red. `conservar y cortar` es lo de §1.1 |
| Fijar el formato del token de versión en el contrato | Pre-diseñaría el modelo de datos de la vertical (ODD #3). Se deja opaco y monótono |
| Confirmar la escritura contra un estado `pending` en el servidor antes de aplicar | Reintroduce el estado *pending* server-side que el ADR 0001 ya descartó para la idempotencia |
