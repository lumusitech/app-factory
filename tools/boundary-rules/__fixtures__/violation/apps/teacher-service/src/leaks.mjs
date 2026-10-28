// Viola `no-cross-app-imports`: una vertical importa de otra vertical.
import { x } from '../../store-service/src/x.mjs';

export const leak = x;
