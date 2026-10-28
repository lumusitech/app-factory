/** Resultado mínimo de una consulta: solo las filas que el kernel necesita. */
export interface QueryResult<TRow> {
  readonly rows: readonly TRow[];
}

/**
 * Ejecutor SQL mínimo.
 *
 * `query` usa el protocolo extendido (parametrizado, **una** sentencia); `exec`
 * el simple (scripts de **varias** sentencias, sin parámetros), necesario para
 * aplicar migraciones. Es la superficie que el kernel usa; el driver concreto
 * (`pg`, PGlite) se adapta acá.
 */
export interface SqlExecutor {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
  exec(text: string): Promise<void>;
}

/** Abre transacciones: commit si el trabajo resuelve, rollback si lanza. */
export interface SqlConnection {
  transaction<TResult>(work: (tx: SqlExecutor) => Promise<TResult>): Promise<TResult>;
}

/** Superficie de `@electric-sql/pglite` que el kernel usa (sin acoplarse al paquete). */
export interface PgliteQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: TRow[] }>;
  exec(text: string): Promise<unknown>;
}

export interface PgliteLike extends PgliteQueryable {
  transaction<TResult>(work: (tx: PgliteQueryable) => Promise<TResult>): Promise<TResult>;
}

/** Superficie de `pg` (`Pool`/`PoolClient`) que el kernel usa. */
export interface PgQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: TRow[] }>;
}

export interface PgClientLike extends PgQueryable {
  release(): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

/** Adapta PGlite a `SqlExecutor`. */
export function createPgliteExecutor(db: PgliteQueryable): SqlExecutor {
  return {
    async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<TRow>> {
      const result = await db.query<TRow>(text, params);
      return { rows: result.rows };
    },
    async exec(text: string): Promise<void> {
      await db.exec(text);
    },
  };
}

/** Adapta PGlite a `SqlConnection` (su `transaction` ya hace BEGIN/COMMIT/ROLLBACK). */
export function createPgliteConnection(db: PgliteLike): SqlConnection {
  return {
    transaction: (work) => db.transaction((tx) => work(createPgliteExecutor(tx))),
  };
}

/** Adapta un cliente de `pg` a `SqlExecutor`. */
export function createPgExecutor(client: PgQueryable): SqlExecutor {
  return {
    async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<TRow>> {
      const result = await client.query<TRow>(text, params);
      return { rows: result.rows };
    },
    async exec(text: string): Promise<void> {
      await client.query(text);
    },
  };
}

/**
 * Adapta un `pg.Pool` a `SqlConnection`: toma un cliente dedicado por
 * transacción (BEGIN/COMMIT/ROLLBACK) y lo libera siempre.
 */
export function createPgConnection(pool: PgPoolLike): SqlConnection {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(createPgExecutor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}