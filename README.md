# app-factory

Monorepo del **kernel compartido** entre verticales de producto. Hoy **no hay
código**: solo documentación de arquitectura y de producto.

> Regla que gobierna todo: el kernel satisface la **intersección** de las
> verticales, nunca la unión (§2 de [`docs/kernel-context.md`](docs/kernel-context.md)).

## Estado

**Fase 1** — `kernel-domain` y `kernel-contracts` (TypeScript puro, **cero
dependencias externas** en runtime). Fase 0 cerrada: contratos y reglas de
frontera en CI.

## Mapa del repositorio

```
app-factory/
├── CONTRIBUTING.md           # cómo se trabaja (leer antes de tocar nada)
├── LICENSE                   # MIT (c) 2026 LumusiTech
├── docs/
│   ├── kernel-context.md     # arquitectura del kernel y decisiones D1–D25
│   ├── teacher-service-context.md
│   └── adr/                  # Architecture Decision Records
├── packages/
│   ├── kernel-domain/        # dominio puro: puertos + DomainEvent (cero deps)
│   └── kernel-contracts/     # envelope, headers, códigos y protocolo de sync
├── apps/                     # verticales (a crear, fase 5+)
└── tools/                    # create-vertical (implementado)
```

## Cómo se trabaja

- `main` está protegida: **todo cambio pasa por PR** y el merge lo hace una
  persona desde la web (squash).
- Un chat o sesión por feature o micro-cambio.
- Flujo, convenciones y checklist: **[`CONTRIBUTING.md`](CONTRIBUTING.md)**.

## Documentos de contexto

| Documento | Para qué |
|---|---|
| [`docs/kernel-context.md`](docs/kernel-context.md) | Arquitectura del kernel, decisiones cerradas (`D1`–`D25`) y prohibiciones duras |
| [`docs/teacher-service-context.md`](docs/teacher-service-context.md) | Producto `teacher-service` (decisiones `T*`, alcance `F-xx`) |

Ambos tienen una sección **§0.1 con un prompt de arranque** para pegar en un chat
nuevo.

## Licencia

[MIT](LICENSE) © 2026 LumusiTech.
