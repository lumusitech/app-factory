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
| [0001](0001-decisiones-contrato-idempotencia.md) | Decisiones del contrato de idempotencia | propuesto |
| [0002](0002-decisiones-contrato-sync.md) | Decisiones del contrato de sync | propuesto |
| [0003](0003-decisiones-contrato-alcance.md) | Decisiones del contrato de alcance | propuesto |
| [0004](0004-decisiones-contrato-evolucion.md) | Decisiones del contrato de evolución | propuesto |
| [0005](0005-decisiones-fase-1-kernel-domain-y-contracts.md) | Materialización de `kernel-domain` y `kernel-contracts` | propuesto |
| [0006](0006-decisiones-fase-2-kernel-http-persistence-scope.md) | Materialización de `kernel-http`, `kernel-persistence` y `kernel-scope` | propuesto |
| [0007](0007-decisiones-kernel-config.md) | Materialización de `kernel-config` (`@kernel/config`) | propuesto |
| [0008](0008-materializacion-kernel-client-y-conformance.md) | Materialización de `kernel-client` y `kernel-conformance` | propuesto |
| [0009](0009-materializacion-create-vertical.md) | Materialización de `tools/create-vertical` (fase 4) | propuesto |
| [0010](0010-token-version-sync-teacher-service.md) | Token de versión de sync y modelo de `Clase` en `teacher-service` | propuesto |
| [0011](0011-captura-de-clase-f-01.md) | Captura de clase (F-01): asistencia, tema y tarea offline | propuesto |
| [0012](0012-calificaciones-f-02.md) | Calificaciones numéricas offline (F-02): modelo de `Evaluación` y `Nota` | propuesto |
| [0013](0013-valoracion-preliminar-f-03.md) | Valoración preliminar TEA/TEP/TED offline (F-03): modelo de `TrajectoryAssessment` | propuesto |
| [0014](0014-planilla-oficial-f-04.md) | Planilla oficial PBA en PDF (F-04): vista derivada, plantilla como dato y render en servidor | propuesto |
| [0015](0015-trayectoria-del-alumno.md) | Trayectoria del alumno (registro): observaciones, evolución y movimientos | propuesto |
| [0016](0016-cierre-de-periodo-f-12.md) | Cierre de período (F-12 parcial): nota automática, override manual y vista derivada | propuesto |
| [0017](0017-planilla-de-uso-diario.md) | Planilla de uso diario imprimible: vista derivada, plantilla como dato y render en servidor | propuesto |
