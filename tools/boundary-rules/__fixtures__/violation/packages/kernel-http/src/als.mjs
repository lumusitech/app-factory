// Viola `scope-resolution-only-in-kernel-scope`: otro paquete resuelve alcance
// con su propio AsyncLocalStorage (el anti-patrón opt-in de §1.2).
import { AsyncLocalStorage } from 'node:async_hooks';

export const storage = new AsyncLocalStorage();