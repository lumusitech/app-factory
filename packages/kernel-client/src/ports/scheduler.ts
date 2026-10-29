export interface SchedulerHandle {
  cancel(): void;
}

/**
 * Puerto de temporización: lo usa el **watchdog** de 20 s (sync §5.2) para acotar
 * un intento. Inyectable para no depender de `setTimeout` global y poder vencer el
 * watchdog en un test sin esperar 20 s reales.
 */
export interface Scheduler {
  /** Ejecuta `fn` tras `ms` milisegundos; devuelve un cancelador. */
  schedule(fn: () => void, ms: number): SchedulerHandle;
}
