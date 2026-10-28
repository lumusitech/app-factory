// Legal: los tests de `kernel-domain` quedan exentos del gate de deps (importan
// `vitest`, npm-dev). Prueba que la exclusión de tests no sobre-dispara.
import { expectTypeOf } from 'vitest';

export const typeOnly = expectTypeOf;
