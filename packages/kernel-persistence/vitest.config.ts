import { defineConfig } from 'vitest/config';

// PGlite es Postgres **WASM, sin contenedor** (D4). Su primera instanciación
// (compilación del WASM) puede superar el default de 5 s —sobre todo en CI con
// carga— sin que el test esté colgado. Se amplía el timeout para no fallar por
// tiempo en tests legítimos; sigue acotado para detectar cuelgues reales.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
