/**
 * Tareas periódicas de mantenimiento de disco para un VPS que corre semanas:
 * tmp/ (restos de stickers y conversiones), ficheros de play-dl en os.tmpdir()
 * y claves de sesión de Baileys muy antiguas. Registra bytes liberados para
 * mostrarlos en /stats.
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

const TASKS = ['cleanup:initial', 'cleanup:tmp', 'cleanup:play-dl', 'cleanup:session'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Las sesiones y sender keys sin tocar en 90 días pertenecen a chats muertos. */
const SESSION_MAX_AGE_MS = 90 * DAY_MS;

export function getCleanupStats(): Readonly<CleanupStats> {
  return stats;
}

/** Borra archivos regulares de `dir` con mtime anterior a `maxAgeMs` que pasen `filter`. */
async function sweepDirectory(
  dir: string,
  maxAgeMs: number,
  filter?: (name: string) => boolean,
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
    if (filter && !filter(name)) continue;
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs < maxAgeMs) continue;
      await unlink(full);
      files++;
      bytes += st.size;
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
  if (files > 0) log.info(`${label}: ${files} archivo(s) eliminado(s), ${Math.round(bytes / 1024)} KB liberados`);
}

async function runTmpSweep(): Promise<void> {
  const { files, bytes } = await sweepDirectory(join(process.cwd(), 'tmp'), 30 * 60 * 1000);
  record('tmp/', files, bytes);
}

async function runPlayDlSweep(): Promise<void> {
  const { files, bytes } = await sweepDirectory(tmpdir(), 60 * 60 * 1000, (name) => name.startsWith('play-dl'));
  record('play-dl', files, bytes);
}

/**
 * Poda solo `session-*` y `sender-key-*` con más de 90 días. Las pre-keys
 * NUNCA se tocan: borrarlas rompe el cifrado con contactos ("Bad MAC").
 */
async function runSessionSweep(): Promise<void> {
  const { files, bytes } = await sweepDirectory(
    CONFIG.authFolder,
    SESSION_MAX_AGE_MS,
    (name) => name.startsWith('session-') || name.startsWith('sender-key-'),
  );
  record(`${CONFIG.authFolder}/`, files, bytes);
}

/** Arranca todas las tareas. Idempotente. */
export function startCleanupScheduler(): void {
  if (TASKS.some((name) => scheduler.has(name))) return;

  // La primera pasada espera un minuto para no competir con el arranque.
  scheduler.after('cleanup:initial', 60 * 1000, async () => {
    await runTmpSweep();
    await runPlayDlSweep();
    await runSessionSweep();
  });
  scheduler.every('cleanup:tmp', 15 * 60 * 1000, runTmpSweep);
  scheduler.every('cleanup:play-dl', 60 * 60 * 1000, runPlayDlSweep);
  scheduler.every('cleanup:session', DAY_MS, runSessionSweep);

  log.info('limpieza programada (tmp 15 min, play-dl 1 h, sesión 24 h)');
}

export function stopCleanupScheduler(): void {
  for (const name of TASKS) scheduler.stop(name);
}
