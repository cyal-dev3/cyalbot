import { DownloadError } from './errors.js';

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

export function clientClosedError(): DownloadError {
  return new DownloadError('CLIENT_CLOSED', 'El cliente cerro la conexion');
}

/**
 * Cola simple de concurrencia limitada. Mantiene como maximo `maxConcurrent` tareas
 * activas; el resto espera en orden FIFO hasta `queueMax`. Si la espera esta llena,
 * `run` rechaza inmediatamente con RATE_LIMITED. Si `signal` se aborta mientras la tarea
 * espera, se saca de la cola y se rechaza con CLIENT_CLOSED sin llegar a ejecutarse.
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

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw clientClosedError();
    await this.acquire(signal);
    try {
      if (signal?.aborted) throw clientClosedError();
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
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
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index === -1) return;
        this.waiting.splice(index, 1);
        reject(clientClosedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(waiter);
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
