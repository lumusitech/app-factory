/**
 * Valor de una entrada de configuración (D19: "almacén clave-valor").
 *
 * Se restringe a JSON a propósito: la configuración es **datos**, no código ni
 * funciones (las plantillas y catálogos son datos de la vertical, §1.4).
 */
export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: ConfigValue }
  | readonly ConfigValue[];