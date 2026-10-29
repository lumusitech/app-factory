# Migraciones de teacher-service

Esta vertical es la **dueña** de su propio esquema
([`docs/contracts/evolution.md`](../../../docs/contracts/evolution.md) §3). El
kernel **no** migra tus tablas, ni al revés.

- **Forward-only**: sin `down`/`revert`/`rollback`. Un error se corrige con una
  migración **compensatoria** hacia adelante (§4).
- **Naming**: `NNNN-kebab-case.sql` (p. ej. `0001-teacher-service-schema.sql`). La
  secuencia es **tuya** y no colisiona con la del kernel (§5).
- Se aplican con `runAppMigrations` (`src/migrations.ts`).

No hay migraciones todavía: agregá la primera cuando definas tu primera entidad.
