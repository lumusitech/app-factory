// Self-test del generador de verticales (fase 4; ADR 0009).
//
// Prueba el generador en dos direcciones, no solo el camino feliz:
//   - CREA el árbol esperado, con el nombre sustituido en el contenido;
//   - RECHAZA nombres inválidos y un destino existente (no sobre-escribe).
//
// Runner: `node:test` + `node:assert` (built-in) — cero devDeps, igual que el
// self-test del gate de fronteras (tools/boundary-rules/self-test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EXPECTED_FILES, generateVertical, validateName } from './index.mjs';

/** Archivos de texto del árbol generado (los únicos que deben carecer de tokens). */
const TEXT_FILE = /\.(ts|mjs|cjs|json|md|sql)$/;

/** Corre `fn` con un directorio temporal y lo limpia siempre. */
async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'create-vertical-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('validateName acepta nombres kebab-case válidos', () => {
  for (const name of ['teacher-service', 'store', 'a', 'mi-vertical-2']) {
    assert.doesNotThrow(() => validateName(name), `debería aceptar "${name}"`);
  }
});

test('validateName rechaza nombres inválidos', () => {
  const invalid = ['', 'Foo', 'foo bar', 'foo_bar', 'foo/', '-foo', 'foo-', 'foo--bar', '1foo', 'a/b', 'accent-é'];
  for (const name of invalid) {
    assert.throws(() => validateName(name), `debería rechazar "${name}"`);
  }
});

test('genera el árbol de archivos esperado', async () => {
  await withTempDir(async (dir) => {
    const dest = path.join(dir, 'mi-vertical');
    await generateVertical({ name: 'mi-vertical', destDir: dest });

    for (const relative of EXPECTED_FILES) {
      assert.ok(existsSync(path.join(dest, relative)), `falta ${relative}`);
    }
  });
});

test('sustituye el nombre en package.json y lo deja como JSON válido', async () => {
  await withTempDir(async (dir) => {
    const dest = path.join(dir, 'mi-vertical');
    await generateVertical({ name: 'mi-vertical', destDir: dest });

    const pkg = JSON.parse(await readFile(path.join(dest, 'package.json'), 'utf8'));
    assert.equal(pkg.name, '@app/mi-vertical');
    assert.equal(pkg.private, true);
    assert.equal(typeof pkg.version, 'string');
    assert.ok(pkg.dependencies['@kernel/http'], 'debe depender del kernel (http)');
    assert.ok(pkg.dependencies['@kernel/scope'], 'debe depender del kernel (scope)');
  });
});

test('no deja el token de plantilla sin sustituir en ningún archivo de texto', async () => {
  await withTempDir(async (dir) => {
    const dest = path.join(dir, 'mi-vertical');
    await generateVertical({ name: 'mi-vertical', destDir: dest });

    const entries = await readdir(dest, { recursive: true });
    for (const relative of entries.filter((entry) => TEXT_FILE.test(entry))) {
      const content = await readFile(path.join(dest, relative), 'utf8');
      assert.ok(!content.includes('{{NAME}}'), `quedó el token sin sustituir en ${relative}`);
    }
  });
});

test('rechaza generar sobre un destino existente (no sobre-escribe)', async () => {
  await withTempDir(async (dir) => {
    const dest = path.join(dir, 'mi-vertical');
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, 'ocupado.txt'), 'no me borres');

    await assert.rejects(() => generateVertical({ name: 'mi-vertical', destDir: dest }));
    assert.ok(existsSync(path.join(dest, 'ocupado.txt')), 'no debe borrar lo existente');
  });
});
