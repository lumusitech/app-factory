# app-factory

Monorepo del **kernel compartido** entre verticales de producto.

> Regla que gobierna todo: el kernel satisface la **intersección** de las
> verticales, nunca la unión (§2 de [`docs/kernel-context.md`](docs/kernel-context.md)).

## Estado

**Fase 4** — `tools/create-vertical`: genera una vertical dentro del monorepo, ya
cableada al kernel (sync, alcance, configuración y tests). Decisiones en el
[ADR 0009](docs/adr/0009-materializacion-create-vertical.md).

**Fase 3** — `kernel-client` + `kernel-conformance`: cola offline, caché GET,
flush con watchdog y la suite de convergencia (*crear → offline → sincronizar →
converger → reintentar sin duplicar*). Decisiones en el
[ADR 0008](docs/adr/0008-materializacion-kernel-client-y-conformance.md).

**Fase 2b** — `kernel-config`: configuración por tenant con **esquema versionado**
y validación (clave-valor, validación inyectada por la vertical). Decisiones en el
[ADR 0007](docs/adr/0007-decisiones-kernel-config.md).

**Fase 2** — `kernel-http` + `kernel-persistence` + `kernel-scope`: un agregado
con invariantes persiste, emite outbox en la misma transacción y respeta alcance
(ver `packages/kernel-http/test/exit-criterion.test.ts`). Decisiones en el
[ADR 0006](docs/adr/0006-decisiones-fase-2-kernel-http-persistence-scope.md).

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
│   ├── contracts/            # los cuatro contratos de la fase 0
│   └── adr/                  # Architecture Decision Records
├── packages/
│   ├── kernel-domain/        # dominio puro: puertos + DomainEvent (cero deps)
│   ├── kernel-contracts/     # envelope, headers, códigos y protocolo de sync
│   ├── kernel-scope/         # ScopeContext + ALS, único seam de alcance
│   ├── kernel-config/        # configuración por tenant con esquema versionado
│   ├── kernel-persistence/   # driver SQL, outbox, migraciones e idempotencia
│   ├── kernel-http/          # Fastify + Zod: envelope, errores, alcance, idempotencia
│   ├── kernel-client/        # cliente offline: cola, caché GET y flush (por puertos)
│   └── kernel-conformance/   # suite de convergencia (test de aceptación del kernel)
├── apps/                     # verticales (creadas con create-vertical; fase 5+)
└── tools/
    └── create-vertical/      # generador de verticales (implementado, fase 4)
```

## Comandos

```bash
pnpm install              # además compila los paquetes (prepare), para el typecheck cruzado
pnpm typecheck            # tsc --noEmit en cada paquete y vertical
pnpm test                 # Vitest (PGlite en memoria: sin contenedor)
pnpm build                # tsc -p tsconfig.build.json
pnpm boundary:check       # reglas de frontera del kernel (dependency-cruiser)
pnpm boundary:selftest
pnpm create-vertical <name>    # genera una vertical en apps/<name> (fase 4)
pnpm create-vertical:selftest  # self-test del generador
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
