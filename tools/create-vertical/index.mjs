// Generador de verticales del monorepo app-factory (fase 4; D3/D20; ADR 0009).
//
// Crea `apps/<name>/` ya **cableada al kernel** (sync, alcance, configuración y
// tests). No es un template repo: la vertical nace dentro del monorepo y comparte
// el kernel por workspace (D1/D2). Sin dependencias: solo Node core.
//
//   Uso:  pnpm create-vertical <name>
//         node tools/create-vertical/index.mjs <name>

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const templatesDir = path.join(here, 'templates', 'vertical');

/** kebab-case ASCII, sin guiones al borde ni duplicados. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Token de plantilla sustituido por el nombre de la vertical. */
const TOKEN = '{{NAME}}';

/** Rutas (relativas al destino) que debe producir el generador. */
export const EXPECTED_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'README.md',
  'src/index.ts',
  'src/app.ts',
  'src/identity.ts',
  'src/config/registry.ts',
  'src/migrations.ts',
  'migrations/README.md',
  'test/app.test.ts',
];

/**
 * Valida el nombre de la vertical. Devuelve el nombre si es válido;
 * lanza con un mensaje legible si no.
 */
export function validateName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error(
      `Nombre de vertical inválido: "${typeof name === 'string' ? name : ''}". ` +
        'Usá kebab-case ASCII que empiece con letra (p. ej. "teacher-service").',
    );
  }
  return name;
}

/** Lista recursivamente los archivos de la plantilla, con rutas relativas. */
async function listFiles(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Genera la vertical `name` en `destDir` (por defecto `apps/<name>`),
 * sustituyendo el token `{{NAME}}` en cada archivo. Rechaza nombres inválidos y
 * **no sobre-escribe** un destino existente (salvo `force`).
 *
 * @returns {Promise<string>} el destino de la vertical creada.
 */
export async function generateVertical({ name, destDir, force = false }) {
  validateName(name);

  const target = destDir ?? path.join(repoRoot, 'apps', name);

  if (existsSync(target) && !force) {
    throw new Error(`El destino ya existe: ${target}. El generador no sobre-escribe.`);
  }

  const files = await listFiles(templatesDir);
  for (const relative of files) {
    const content = await readFile(path.join(templatesDir, relative), 'utf8');
    const rendered = content.split(TOKEN).join(name);
    const outPath = path.join(target, relative);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, rendered, 'utf8');
  }

  return target;
}

/** Entrada de línea de comandos. */
async function main(argv) {
  const name = argv[2];
  if (name === undefined) {
    console.error('Uso: node tools/create-vertical/index.mjs <name>');
    process.exitCode = 1;
    return;
  }

  try {
    const target = await generateVertical({ name });
    console.log(`Vertical creada en ${path.relative(repoRoot, target)}/`);
    console.log(`Siguiente: pnpm install && pnpm --filter @app/${name} test`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv);
}
