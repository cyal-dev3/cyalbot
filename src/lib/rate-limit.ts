/**
 * Limitador de ventana deslizante: como máximo `max` aciertos por clave en los
 * últimos `windowMs`. Las claves sin marcas vigentes se borran para que el mapa
 * no crezca con usuarios que pasaron una vez.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Milisegundos hasta que la clave vuelva a tener hueco (0 si ok). */
  retryInMs: number;
  /** Intentos que quedan en la ventana tras este (0 si no pasó). */
  remaining: number;
}

export class RateLimiter {
  private readonly stamps = new Map<string, number[]>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {
    if (!Number.isFinite(max) || max < 1) throw new Error('RateLimiter: max debe ser >= 1');
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('RateLimiter: windowMs debe ser > 0');
  }

  /** Intenta consumir un hueco para `key`. Solo cuenta si pasó. */
  try(key: string, now = Date.now()): RateLimitResult {
    const live = this.prune(key, now);
    if (live.length >= this.max) {
      return { ok: false, retryInMs: Math.max(1, live[0] + this.windowMs - now), remaining: 0 };
    }
    live.push(now);
    this.stamps.set(key, live);
    return { ok: true, retryInMs: 0, remaining: this.max - live.length };
  }

  /** Aciertos vigentes de la clave sin consumir ninguno. */
  count(key: string, now = Date.now()): number {
    return this.prune(key, now).length;
  }

  /** Olvida una clave entera. */
  reset(key: string): void {
    this.stamps.delete(key);
  }

  /**
   * Devuelve el último hueco consumido de la clave (la acción no llegó a
   * ejecutarse). Solo quita una marca, no la ventana completa.
   */
  undo(key: string): void {
    const live = this.stamps.get(key);
    if (!live) return;
    live.pop();
    if (live.length === 0) this.stamps.delete(key);
  }

  get size(): number {
    return this.stamps.size;
  }

  private prune(key: string, now: number): number[] {
    const live = (this.stamps.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (live.length === 0) this.stamps.delete(key);
    else this.stamps.set(key, live);
    return live;
  }
}
