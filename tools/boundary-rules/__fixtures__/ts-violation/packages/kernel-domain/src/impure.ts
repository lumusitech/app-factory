// Prueba que el gate escanea **TypeScript** (no solo `.js`/`.mjs`): esta fixture
// es idéntica a `violation/packages/kernel-domain/src/impure.mjs`, pero en `.ts`.
// Si el gate no escaneara `.ts`, no habría violaciones y el self-test fallaría.
import 'fastify';

export const impure = true;
