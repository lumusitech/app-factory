/**
 * Entrada de la caché GET offline (§1.1). Guarda el body **ya desenvuelto** (el
 * `data` del envelope, no el envelope entero).
 */
export interface CachedGet {
  /** Clave de la entrada (el llamador decide; normalmente method + path). */
  readonly key: string;
  /** Body YA desenvuelto (sync §1.1). */
  readonly data: unknown;
  /** Instante de guardado, ISO 8601 (base del TTL). */
  readonly storedAt: string;
  /** Instante del último acceso, ISO 8601 (base del desalojo LRU). */
  readonly lastAccessedAt: string;
}

/**
 * Persistencia local de la caché GET (§1.1). Adaptador; el núcleo no conoce el
 * motor.
 */
export interface GetCacheStore {
  get(key: string): Promise<CachedGet | null>;
  set(entry: CachedGet): Promise<void>;
  delete(key: string): Promise<void>;
  /** Todas las entradas (para el desalojo LRU del núcleo). */
  list(): Promise<readonly CachedGet[]>;
}
