// Viola `no-cross-app-imports`: `teacher-service-v2` comparte prefijo con
// `teacher-service`, pero son apps distintas. Cubre el borde de nombres con
// prefijo común sobre el backreference anclado (`^$1`).
import { x } from '../../teacher-service/src/x.mjs';

export const leak = x;
