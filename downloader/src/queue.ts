import { DownloadError } from './errors.js';

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Cola simple de concurrencia limitada. Mantiene como maximo `maxConcurrent` tareas
 * activas; el resto espera en orden FIFO hasta `queueMax`. Si la espera esta llena,
 * `run` rechaza inmediatamente con RATE_LIMITED.
 */
export class Queue {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly queueMax: number,
  ) {
    if (maxConcurrent < 1) throw new Error('maxConcurrent debe ser >= 1');
    if (queueMax < 0) throw new Error('queueMax debe ser >= 0');
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.queueMax) {
      return Promise.reject(
        new DownloadError('RATE_LIMITED', `Cola llena (${this.queueMax} en espera). Intenta de nuevo en unos segundos.`),
      );
    }
    return new Promise<void>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // El hueco pasa directamente al siguiente; `active` no cambia.
      next.resolve();
    } else {
      this.active -= 1;
    }
  }
}
