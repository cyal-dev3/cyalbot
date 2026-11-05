/**
 * Registro central de timers periódicos y diferidos. Todos van con unref()
 * para no mantener vivo el proceso, capturan los errores de la tarea y se
 * pueden detener de golpe en el apagado.
 */

import { createLogger } from './logger.js';

const log = createLogger('scheduler');

type Task = () => void | Promise<void>;

interface Entry {
  name: string;
  kind: 'every' | 'after';
  ms: number;
  timer: NodeJS.Timeout;
  createdAt: number;
  runs: number;
  lastError?: string;
}

const entries = new Map<string, Entry>();

function run(entry: Entry, fn: Task): void {
  entry.runs++;
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((error) => fail(entry, error));
    }
  } catch (error) {
    fail(entry, error);
  }
}

function fail(entry: Entry, error: unknown): void {
  entry.lastError = error instanceof Error ? error.message : String(error);
  log.error(`tarea ${entry.name} falló:`, error);
}

/** Ejecuta `fn` cada `ms`. Si ya había una tarea con ese nombre, la reemplaza. */
export function every(name: string, ms: number, fn: Task): void {
  stop(name);
  const entry: Entry = { name, kind: 'every', ms, createdAt: Date.now(), runs: 0, timer: undefined as unknown as NodeJS.Timeout };
  entry.timer = setInterval(() => run(entry, fn), ms);
  entry.timer.unref();
  entries.set(name, entry);
}

/** Ejecuta `fn` una vez pasados `ms`. Si ya había una tarea con ese nombre, la reemplaza. */
export function after(name: string, ms: number, fn: Task): void {
  stop(name);
  const entry: Entry = { name, kind: 'after', ms, createdAt: Date.now(), runs: 0, timer: undefined as unknown as NodeJS.Timeout };
  entry.timer = setTimeout(() => {
    entries.delete(name);
    run(entry, fn);
  }, ms);
  entry.timer.unref();
  entries.set(name, entry);
}

/** Cancela una tarea. Devuelve true si existía. */
export function stop(name: string): boolean {
  const entry = entries.get(name);
  if (!entry) return false;
  clearTimeout(entry.timer);
  entries.delete(name);
  return true;
}

export function has(name: string): boolean {
  return entries.has(name);
}

export interface ScheduledTaskInfo {
  name: string;
  kind: 'every' | 'after';
  ms: number;
  runs: number;
  lastError?: string;
}

export function list(): ScheduledTaskInfo[] {
  return [...entries.values()].map(({ name, kind, ms, runs, lastError }) => ({ name, kind, ms, runs, lastError }));
}

export function stopAll(): number {
  const count = entries.size;
  for (const entry of entries.values()) clearTimeout(entry.timer);
  entries.clear();
  return count;
}
