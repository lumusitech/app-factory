// Legal: los tests de `kernel-contracts` quedan exentos del gate de deps
// (importan `vitest`/`ajv`, npm-dev). Prueba que la exclusión no sobre-dispara.
import { expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';

export const helpers = { expect, Ajv2020 };
