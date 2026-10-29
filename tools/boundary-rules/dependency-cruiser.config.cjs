'use strict';

const { boundaryRules } = require('./rules.cjs');

// Config real del gate de fronteras (fase 0).
//
// `parser: 'swc'` es lo que habilita el escaneo **real** de TypeScript. Sin él,
// dependency-cruiser 18 usa su transpiler de TS, que sólo soporta
// `typescript >=2 <7`, y este monorepo usa TS 7 → quedaría en modo JavaScript y
// las reglas D15 **no** se aplicarían al código fuente `.ts`. Con `@swc/core`
// (devDependency de la raíz) depcruise extrae las dependencias de los `.ts`.
// Además se excluye `dist/`: la frontera es sobre el fuente, no sobre la salida
// derivada. El self-test (fixture `ts-violation`) falla si el escaneo de TS se
// pierde, así que la degradación silenciosa no es posible.
//
// IMPORTANTE: excluye `__fixtures__/`, que viola las reglas a propósito. El
// self-test reutiliza esta misma config pero corre con `cwd` en la raíz de la
// fixture, donde el patrón de exclusión (`tools/boundary-rules/__fixtures__/`)
// no matchea los paths relativos de la fixture (`apps/…`, `packages/…`).
module.exports = {
  forbidden: boundaryRules,
  options: {
    doNotFollow: { path: 'node_modules' },
    parser: 'swc',
    exclude: {
      path: '(^|/)node_modules/|(^|/)dist/|(^|/)tools/boundary-rules/__fixtures__/',
    },
  },
};
