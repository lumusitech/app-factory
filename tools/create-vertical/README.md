# `tools/create-vertical`

Generador de verticales del monorepo **app-factory** (fase 4 de
[`docs/kernel-context.md`](../../docs/kernel-context.md) §7; decisiones D3/D20;
[ADR 0009](../../docs/adr/0009-materializacion-create-vertical.md)).

No es un *template repo* (D1): crea una vertical **dentro** del monorepo, ya
cableada al kernel y con tests verdes. Un fix en la plantilla llega a N
verticales.

## Uso

```bash
pnpm create-vertical <name>
# o
node tools/create-vertical/index.mjs <name>
```

Crea `apps/<name>/`. El nombre debe ser **kebab-case ASCII** que empiece con
letra (`teacher-service`, `store`). El generador **rechaza** un destino existente:
no sobre-escribe.

## Qué genera

Una vertical cableada al kernel, **sin dominio adentro**:

- `package.json` (`@app/<name>`, `private`, `"version"`, deps `@kernel/*` por
  `workspace:*`), `tsconfig.json` + `tsconfig.build.json`.
- `src/app.ts`: composition root sobre `@kernel/http` (`buildServer`): envelope,
  errores, **alcance** e **idempotencia**.
- `src/identity.ts`: `SessionResolver` **placeholder** (la autenticación real es
  un contrato aparte).
- `src/config/registry.ts`: `ConfigSchemaRegistry` **vacío** (fail-closed,
  `@kernel/config`).
- `src/migrations.ts`: migraciones del kernel + las **propias** (dueño único,
  `docs/contracts/evolution.md` §3).
- `test/app.test.ts`: smoke + **bordes** (probe sin alcance, alcance fail-closed,
  migraciones aplicadas).

**No** trae UI (`kernel-ui`) ni agregado de dominio: se agregan cuando exista su
consumidor real (ODD #1).

## Cómo se prueba

- `pnpm create-vertical:selftest` — self-test del generador (node:test, sin
  deps): árbol esperado, sustitución del nombre, rechazo de nombres inválidos y
  de destino existente.
- El CI (job `create-vertical`) genera una vertical **scratch**, instala y corre
  `typecheck` + `test` + `boundary:check` sobre ella: materializa el criterio de
  salida *"tests verdes"*.
