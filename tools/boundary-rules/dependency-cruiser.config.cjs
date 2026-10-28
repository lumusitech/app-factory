'use strict';

const { boundaryRules } = require('./rules.cjs');

// Config real del gate de fronteras (fase 0).
//
// IMPORTANTE: excluye `__fixtures__/`, que viola las reglas a propósito. El
// self-test reutiliza esta misma config pero corre con `cwd` en la raíz de la
// fixture, donde el patrón de exclusión (`tools/boundary-rules/__fixtures__/`)
// no matchea los paths relativos de la fixture (`apps/…`, `packages/…`).
module.exports = {
  forbidden: boundaryRules,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^|/)node_modules/|(^|/)tools/boundary-rules/__fixtures__/',
    },
  },
};
