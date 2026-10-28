/**
 * `@kernel/config` — configuración por tenant del kernel (D19; ADR 0007).
 *
 * Agregado `ConfigEntry` (clave-valor con **esquema versionado** y validación),
 * puerto por agregado (D6) y casos de uso. El **catálogo de claves y esquemas es
 * de la vertical** (`ConfigSchemaRegistry`); el kernel no es un CMS ni un motor de
 * reglas. Sin frameworks y sin adaptadores (fronteras de ADR 0007).
 */
export {
  CONFIG_KEY_MAX_LENGTH,
  ConfigEntry,
  normalizeConfigKey,
} from './config-entry.js';
export type {
  ConfigEntryCreateInput,
  ConfigEntryReplaceInput,
  ConfigEntrySnapshot,
} from './config-entry.js';
export {
  InvalidConfigKeyError,
  InvalidConfigValueError,
  UnknownConfigKeyError,
} from './config-errors.js';
export type { ConfigEntryRepository, ConfigSchemaRegistry } from './config-ports.js';
export { ConfigService } from './config-service.js';
export type { ConfigServiceDependencies, SetConfigInput } from './config-service.js';
export type { ConfigValue } from './config-value.js';