// Self-test del gate de fronteras (D15).
//
// Prueba el gate en dos direcciones, no solo el camino feliz:
//   - `violation/` DEBE fallar y con el set EXACTO de reglas esperado.
//   - `clean/`    DEBE pasar (el gate no sobre-dispara).
//
// Usa el CLI para ejercitar el mismo camino que el CI. Nota: el reporter `json`
// fija su `exitCode` en 0 (dependency-cruiser/src/report/json.mjs), así que el
// veredicto del gate se toma del reporter por defecto (`err`), que es el que usa
// el CI; el `json` se usa solo para inspeccionar qué reglas se violaron.
//
// Runner: `node:test` + `node:assert` (built-in) — cero devDeps de test en fase 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const depcruiseBin = path.join(repoRoot, 'node_modules', '.bin', 'depcruise');
const configPath = path.join(here, 'dependency-cruiser.config.cjs');

/**
 * Corre depcruise sobre una fixture con `cwd` en su raíz, para que los patrones
 * de ruta (`^apps/`, `^packages/kernel-…`) apliquen igual que en el repo.
 * @param {string} fixtureName
 * @param {'err' | 'json'} outputType
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function depcruise(fixtureName, outputType) {
  const cwd = path.join(here, '__fixtures__', fixtureName);
  const args =
    outputType === 'json'
      ? ['--output-type', 'json', '--config', configPath, '.']
      : ['--config', configPath, '.'];
  const res = spawnSync(depcruiseBin, args, { cwd, encoding: 'utf8' });

  assert.equal(res.error, undefined, `no se pudo ejecutar depcruise: ${res.error}`);
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Reglas violadas en una fixture, según la salida `json`. @param {string} fixtureName */
function violatedRules(fixtureName) {
  const res = depcruise(fixtureName, 'json');
  assert.notEqual(res.stdout, '', `depcruise no emitió JSON. stderr: ${res.stderr}`);

  const { violations } = JSON.parse(res.stdout).summary;
  return [...new Set(violations.map((v) => v.rule.name))].sort();
}

test('la fixture `violation` hace fallar al gate con el set exacto de reglas', () => {
  // Veredicto del gate: la salida por defecto (`err`), igual que en el CI.
  const gate = depcruise('violation', 'err');
  assert.notEqual(gate.status, 0, 'el gate debió fallar sobre la fixture `violation`');

  // Detalle: qué reglas dispararon.
  assert.deepEqual(violatedRules('violation'), [
    'kernel-contracts-is-framework-free',
    'kernel-does-not-import-apps',
    'kernel-domain-is-framework-free',
    'no-cross-app-imports',
  ]);
});

test('la fixture `clean` no hace fallar al gate (no sobre-dispara)', () => {
  const gate = depcruise('clean', 'err');
  assert.equal(gate.status, 0, 'el gate no debió fallar sobre la fixture `clean`');

  assert.deepEqual(violatedRules('clean'), []);
});
