/**
 * Tareas periódicas de mantenimiento de disco para un VPS que corre semanas:
 * la carpeta de temporales de ffmpeg (restos de stickers y conversiones) y las
 * claves de sesión de Baileys muy antiguas. Registra bytes liberados para
 * mostrarlos en /botstats.
 */

import { readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG } from '../config.js';
import { createLogger } from './logger.js';
import * as scheduler from './scheduler.js';

const log = createLogger('cleanup');

interface CleanupStats {
  lastRunAt: number | null;
  lastBytesFreed: number;
  totalBytesFreed: number;
  totalFilesDeleted: number;
}

const stats: CleanupStats = {
  lastRunAt: null,
  lastBytesFreed: 0,
  totalBytesFreed: 0,
  totalFilesDeleted: 0,
};

const TASKS = ['cleanup:initial', 'cleanup:tmp', 'cleanup:session'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Un temporal de ffmpeg vive lo que dura una conversión; media hora sin tocar es un resto. */
const TMP_MAX_AGE_MS = 30 * 60 * 1000;
/** Las sesiones y sender keys sin tocar en 90 días pertenecen a chats muertos. */
const SESSION_MAX_AGE_MS = 90 * DAY_MS;

export function getCleanupStats(): Readonly<CleanupStats> {
  return stats;
}

interface SweepOptions {
  filter?: (name: string) => boolean;
  /** Borrar también subcarpetas viejas (p. ej. los frames_* de un sticker a medias). */
  directories?: boolean;
}

/** Tamaño total de un directorio (para contabilizar lo liberado). */
async function directorySize(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const name of await readdir(dir)) {
      const st = await stat(join(dir, name));
      total += st.isDirectory() ? await directorySize(join(dir, name)) : st.size;
    }
  } catch {
    // se recorrió lo que se pudo
  }
  return total;
}

/** Borra entradas de `dir` con mtime anterior a `maxAgeMs` que pasen `filter`. */
export async function sweepDirectory(
  dir: string,
  maxAgeMs: number,
  options: SweepOptions = {},
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { files, bytes };
  }
  const now = Date.now();
  for (const name of entries) {
    if (options.filter && !options.filter(name)) continue;
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (now - st.mtimeMs < maxAgeMs) continue;
      if (st.isFile()) {
        await unlink(full);
        files++;
        bytes += st.size;
      } else if (st.isDirectory() && options.directories) {
        const size = await directorySize(full);
        await rm(full, { recursive: true, force: true });
        files++;
        bytes += size;
      }
    } catch {
      // permisos o carrera con otro proceso: se ignora
    }
  }
  return { files, bytes };
}

function record(label: string, files: number, bytes: number): void {
  stats.lastRunAt = Date.now();
  stats.lastBytesFreed = bytes;
  stats.totalBytesFreed += bytes;
  stats.totalFilesDeleted += files;
  if (files > 0) log.info(`${label}: ${files} entrada(s) eliminada(s), ${Math.round(bytes / 1024)} KB liberados`);
}

async function runTmpSweep(): Promise<void> {
  const { files, bytes } = await sweepDirectory(CONFIG.tmpDir, TMP_MAX_AGE_MS, { directories: true });
  record(CONFIG.tmpDir, files, bytes);
}

/**
 * Poda solo `session-*` y `sender-key-*` con más de 90 días. Las pre-keys
 * NUNCA se tocan: borrarlas rompe el cifrado con contactos ("Bad MAC").
 */
async function runSessionSweep(): Promise<void> {
  const { files, bytes } = await sweepDirectory(CONFIG.authFolder, SESSION_MAX_AGE_MS, {
    filter: (name) => name.startsWith('session-') || name.startsWith('sender-key-'),
  });
  record(`${CONFIG.authFolder}/`, files, bytes);
}

/** Arranca todas las tareas. Idempotente. */
export function startCleanupScheduler(): void {
  if (TASKS.some((name) => scheduler.has(name))) return;

  // La primera pasada espera un minuto para no competir con el arranque.
  scheduler.after('cleanup:initial', 60 * 1000, async () => {
    await runTmpSweep();
    await runSessionSweep();
  });
  scheduler.every('cleanup:tmp', 15 * 60 * 1000, runTmpSweep);
  scheduler.every('cleanup:session', DAY_MS, runSessionSweep);

  log.info('limpieza programada (tmp 15 min, sesión 24 h)');
}

export function stopCleanupScheduler(): void {
  for (const name of TASKS) scheduler.stop(name);
}
