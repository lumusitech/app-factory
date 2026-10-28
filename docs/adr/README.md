# Architecture Decision Records (ADR)

Un ADR registra una decisión de arquitectura **explícita**: qué se decidió, por
qué, y qué consecuencias tiene. Es el mecanismo de D23.2 (el contrato precede al
código) y de [`CONTRIBUTING.md`](../CONTRIBUTING.md) §6 ("si el cambio contradice
una decisión, se propone un ADR antes de escribir código").

## Cuándo escribir uno

- El cambio contradice o matiza una decisión `D*` / `T*`.
- Se introduce una dependencia, un límite de paquete o un contrato nuevo.
- Se elige entre alternativas con consecuencias difíciles de revertir.
- Se **supersede** un ADR anterior.

Si la decisión ya está en `docs/kernel-context.md` §3 (`D*`) o en el documento de
producto (`T*`), **no** se duplica acá: el ADR es para lo que aún no está
decidido.

## Convención

- Nombre: `NNNN-titulo-corto.md` en `kebab-case`, ASCII, sin tildes ni `ñ`.
- `NNNN`: número secuencial de cuatro dígitos (`0001`, `0002`, …).
- Estados: `propuesto`, `aceptado`, `rechazado`, `superado`.
- Un ADR **no se edita** una vez aceptado: se **supersede** con uno nuevo que lo
  referencia.
- Idioma: español (es documentación).

## Plantilla

Copiar [`0000-template.md`](0000-template.md) al siguiente número libre.

## Índice

| # | Título | Estado |
|---|---|---|
| — | *(sin ADRs todavía)* | — |
