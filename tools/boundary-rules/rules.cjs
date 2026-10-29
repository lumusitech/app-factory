'use strict';

// Reglas de frontera del kernel — D15 (docs/kernel-context.md §3) y §6.
//
// Fuente única: las consumen la config real (`dependency-cruiser.config.cjs`)
// y el self-test (`self-test.mjs`). No duplicar patrones entre ambos.
//
// Las reglas de "sin deps externas" excluyen los archivos de test
// (`*.test.ts`, `*.test-d.ts`): los tests importan `vitest` (npm-dev) y, en
// `kernel-contracts`, `ajv`. Permitir eso en `src` (runtime) sería una violación;
// en un test es legítimo.

/** Archivos que no son runtime (tests), fuera del gate de dependencias. */
const TEST_FILES = String.raw`(\.test\.ts|\.test-d\.ts)$`;

/** @type {import('dependency-cruiser').IConfiguration['forbidden']} */
const boundaryRules = [
  {
    name: 'no-cross-app-imports',
    severity: 'error',
    comment: 'D15: una vertical (apps/*) no importa de otra vertical (apps/*).',
    // El backreference va anclado (`^$1`): sin el `^`, `apps/teacher-service-v2`
    // se permitiría por error al compartir prefijo con `apps/teacher-service/`.
    from: { path: '^(apps/[^/]+/)' },
    to: { path: '^apps/', pathNot: ['^$1'] },
  },
  {
    name: 'kernel-does-not-import-apps',
    severity: 'error',
    comment: 'D15: el kernel (packages/kernel-*) no importa de ninguna vertical (apps/*).',
    from: { path: '^packages/kernel-' },
    to: { path: '^apps/' },
  },
  {
    name: 'kernel-domain-is-framework-free',
    severity: 'error',
    comment: 'D5/D15: kernel-domain solo importa módulos locales y core; cero deps npm (fuera de tests).',
    from: { path: '^packages/kernel-domain/', pathNot: TEST_FILES },
    // Todo lo que no sea local ni core (npm, npm-dev, npm-no-pkg, npm-unknown…)
    // es violación. Dispara aunque el framework no esté instalado en la fixture.
    to: { dependencyTypesNot: ['local', 'core'] },
  },
  {
    name: 'kernel-contracts-is-framework-free',
    severity: 'error',
    comment: '§7/ADR 0005: kernel-contracts solo importa módulos locales y core; cero deps npm (fuera de tests).',
    from: { path: '^packages/kernel-contracts/', pathNot: TEST_FILES },
    to: { dependencyTypesNot: ['local', 'core'] },
  },
  {
    name: 'kernel-scope-is-framework-free',
    severity: 'error',
    comment: '§4/ADR 0006: kernel-scope solo importa módulos locales y core (node:async_hooks); cero deps npm (fuera de tests).',
    from: { path: '^packages/kernel-scope/', pathNot: TEST_FILES },
    to: { dependencyTypesNot: ['local', 'core'] },
  },
  {
    name: 'scope-resolution-only-in-kernel-scope',
    severity: 'error',
    comment: 'scope.md §8 / D11: la resolución de alcance (AsyncLocalStorage) vive solo en kernel-scope; ningún otro paquete importa async_hooks.',
    from: { pathNot: '^packages/kernel-scope/' },
    to: { path: '^(node:)?async_hooks$' },
  },
  {
    name: 'kernel-config-is-framework-free',
    severity: 'error',
    comment: 'ADR 0007/D15: kernel-config solo importa módulos locales, core y los paquetes de dominio del kernel (domain/scope); cero frameworks (fuera de tests).',
    from: { path: '^packages/kernel-config/', pathNot: TEST_FILES },
    to: {
      dependencyTypesNot: ['local', 'core'],
      pathNot: '^(@kernel/(domain|scope)|packages/kernel-(domain|scope)/)',
    },
  },
  {
    name: 'kernel-config-no-adapters',
    severity: 'error',
    comment: 'ADR 0007/D7: kernel-config (dominio) no importa adaptadores (kernel-http, kernel-persistence).',
    from: { path: '^packages/kernel-config/', pathNot: TEST_FILES },
    to: { path: '^(@kernel/(http|persistence)|packages/kernel-(http|persistence)/)' },
  },
  {
    name: 'kernel-client-is-framework-free',
    severity: 'error',
    comment: 'D14/D15: kernel-client solo importa módulos locales, core y los puertos del kernel (domain/contracts); cero frameworks (fuera de tests).',
    from: { path: '^packages/kernel-client/', pathNot: TEST_FILES },
    to: {
      dependencyTypesNot: ['local', 'core'],
      pathNot: '^(@kernel/(domain|contracts)|packages/kernel-(domain|contracts)/)',
    },
  },
  {
    name: 'kernel-client-no-adapters',
    severity: 'error',
    comment: 'D7/§1.2: kernel-client (cliente, parametrizado por puertos) no importa adaptadores (kernel-http, kernel-persistence, kernel-config, kernel-scope).',
    from: { path: '^packages/kernel-client/', pathNot: TEST_FILES },
    to: {
      path: '^(@kernel/(http|persistence|config|scope)|packages/kernel-(http|persistence|config|scope)/)',
    },
  },
];

module.exports = { boundaryRules };
