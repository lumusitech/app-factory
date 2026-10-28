import type { Pool, PoolClient } from 'pg';

import type { PgClientLike, PgPoolLike } from './executor.js';

// Solo typecheck (no se ejecuta): `pg.Pool` y `pg.PoolClient` deben satisfacer
// las superficies que `kernel-persistence` usa, sin acoplar el paquete a los
// tipos del driver. Si `pg` cambia de forma incompatible, el typecheck falla.
declare const pool: Pool;
declare const client: PoolClient;

export const poolIsCompatible: PgPoolLike = pool;
export const clientIsCompatible: PgClientLike = client;