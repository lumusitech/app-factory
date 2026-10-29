// Viola `kernel-client-no-adapters`: el cliente importa un adaptador
// (kernel-persistence), que un cliente parametrizado por puertos no debe conocer.
import { x } from '../../kernel-persistence/src/x.mjs';

export const leak = x;
