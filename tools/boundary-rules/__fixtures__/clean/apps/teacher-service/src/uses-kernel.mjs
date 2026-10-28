// Legal: apps→packages está permitido, y el import intra-app también.
import { pure } from '../../../packages/kernel-domain/src/pure.mjs';
import { local } from './local.mjs';

export const combined = { pure, local };
