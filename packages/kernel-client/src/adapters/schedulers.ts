import type { Scheduler, SchedulerHandle } from '../ports/scheduler.js';

/** Scheduler real: usa `setTimeout`/`clearTimeout` (Node o navegador). */
export class TimeoutScheduler implements Scheduler {
  schedule(fn: () => void, ms: number): SchedulerHandle {
    const handle = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(handle) };
  }
}

interface PendingTimer {
  readonly fn: () => void;
  readonly ms: number;
}

/**
 * Scheduler **manual** para tests: no dispara solo. El test decide cuándo vence
 * el watchdog con `fireAll()` — así se prueba el corte por watchdog sin esperar
 * 20 s reales.
 */
export class ManualScheduler implements Scheduler {
  #pending: PendingTimer[] = [];

  schedule(fn: () => void, ms: number): SchedulerHandle {
    const timer: PendingTimer = { fn, ms };
    this.#pending.push(timer);
    return {
      cancel: () => {
        this.#pending = this.#pending.filter((candidate) => candidate !== timer);
      },
    };
  }

  /** Programadores pendientes (aún no disparados ni cancelados). */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Dispara todos los temporizadores pendientes (p. ej. vence el watchdog). */
  fireAll(): void {
    const timers = this.#pending;
    this.#pending = [];
    for (const timer of timers) {
      timer.fn();
    }
  }
}
