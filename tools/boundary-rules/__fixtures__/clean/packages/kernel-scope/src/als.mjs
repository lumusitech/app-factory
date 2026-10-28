// Legal: kernel-scope ES el seam de alcance, así que puede importar el ALS de
// Node. Prueba que `scope-resolution-only-in-kernel-scope` no sobre-dispara.
import { AsyncLocalStorage } from 'node:async_hooks';

export const storage = new AsyncLocalStorage();