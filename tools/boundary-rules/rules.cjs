'use strict';

// Reglas de frontera del kernel — D15 (docs/kernel-context.md §3) y §6.
//
// Fuente única: las consumen la config real (`dependency-cruiser.config.cjs`)
// y el self-test (`self-test.mjs`). No duplicar patrones entre ambos.
//
// Nota para la fase 1: cuando exista `packages/kernel-domain` con tests, los
// tests importarán `vitest` (npm-dev). `kernel-domain-is-framework-free` deberá
// permitir `npm-dev` o excluir `*.test.*` para no bloquear los tests del dominio.

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
    comment: 'D5/D15: kernel-domain solo importa módulos locales y core; cero deps npm.',
    from: { path: '^packages/kernel-domain/' },
    // Todo lo que no sea local ni core (npm, npm-no-pkg, npm-unknown…) es violación.
    // Dispara aunque el framework no esté instalado en la fixture.
    to: { dependencyTypesNot: ['local', 'core'] },
  },
];

module.exports = { boundaryRules };
