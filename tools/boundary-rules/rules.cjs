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
];

module.exports = { boundaryRules };
