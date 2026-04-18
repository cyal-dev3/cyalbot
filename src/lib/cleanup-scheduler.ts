/**
 * 🧹 Cleanup Scheduler — tareas periódicas de mantenimiento para VPS
 *
 * - Sweep de tmp/ (archivos temporales de sticker / video conversion huérfanos tras crash)
 * - Poda de CyaltronicSession/ (pre-keys / sessions viejas)
 * - Sweep de play-dl en os.tmpdir()
 *
 * Diseñado para correr días/semanas sin intervención. Registra bytes liberados
 * para poder observarlo desde /admin-stats.
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import chalk from 'chalk';
import { CONFIG } from '../config.js';

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
  totalFilesDeleted: 0
};

let tmpSweepInterval: NodeJS.Timeout | null = null;
let sessionSweepInterval: NodeJS.Timeout | null = null;
let playDlSweepInterval: NodeJS.Timeout | null = null;

export function getCleanupStats(): Readonly<CleanupStats> {
  return stats;
}

/**
 * Borra archivos en `dir` cuyo mtime sea anterior a `maxAgeMs`.
 * Opcionalmente filtra por prefijo/extensión. Devuelve bytes liberados.
 */
async function sweepDirectory(
  dir: string,
  maxAgeMs: number,
  filter?: (name: string) => boolean
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
      // permisos / carrera con otro proceso: ignorar
    }
  }
  return { files, bytes };
}

async function runTmpSweep(): Promise<void> {
  const dir = join(process.cwd(), 'tmp');
  const { files, bytes } = await sweepDirectory(dir, 30 * 60 * 1000);
  if (files > 0) {
    console.log(chalk.gray(`🧹 tmp/: ${files} archivo(s) eliminado(s), ${Math.round(bytes / 1024)} KB liberado(s)`));
  }
  record(files, bytes);
}

async function runPlayDlSweep(): Promise<void> {
  // play-dl crea ficheros en os.tmpdir() con el prefijo 'play-dl'
  const { files, bytes } = await sweepDirectory(
    tmpdir(),
    60 * 60 * 1000,
    (name) => name.startsWith('play-dl')
  );
  if (files > 0) {
    console.log(chalk.gray(`🧹 play-dl: ${files} archivo(s) eliminado(s), ${Math.round(bytes / 1024)} KB liberado(s)`));
  }
  record(files, bytes);
}

async function runSessionSweep(): Promise<void> {
  const dir = CONFIG.authFolder;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const KEEP_PRE_KEYS = 20;

  // Agrupar pre-keys por mtime para conservar las más recientes
  type Entry = { name: string; full: string; mtime: number; size: number };
  const preKeys: Entry[] = [];
  const deletableOld: Entry[] = [];

  for (const name of entries) {
    // Nunca tocar creds.json ni claves de sync de estado
    if (name === 'creds.json') continue;
    if (name.startsWith('app-state-sync-')) continue;

    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    // Margen de seguridad: no tocar nada modificado en las últimas 24h
    if (now - st.mtimeMs < 24 * 60 * 60 * 1000) continue;

    const entry: Entry = { name, full, mtime: st.mtimeMs, size: st.size };
    if (name.startsWith('pre-key-')) {
      preKeys.push(entry);
    } else if (
      (name.startsWith('session-') || name.startsWith('sender-key-')) &&
      now - st.mtimeMs > THIRTY_DAYS
    ) {
      deletableOld.push(entry);
    }
  }

  // Conservar las 20 pre-keys más recientes, borrar el resto
  preKeys.sort((a, b) => b.mtime - a.mtime);
  const oldPreKeys = preKeys.slice(KEEP_PRE_KEYS);

  let files = 0;
  let bytes = 0;
  for (const e of [...oldPreKeys, ...deletableOld]) {
    try {
      await unlink(e.full);
      files++;
      bytes += e.size;
    } catch {
      // ignorar errores puntuales
    }
  }

  if (files > 0) {
    console.log(chalk.gray(`🧹 ${CONFIG.authFolder}/: ${files} archivo(s) podado(s), ${Math.round(bytes / 1024)} KB liberado(s)`));
  }
  record(files, bytes);
}

function record(files: number, bytes: number): void {
  stats.lastRunAt = Date.now();
  stats.lastBytesFreed = bytes;
  stats.totalBytesFreed += bytes;
  stats.totalFilesDeleted += files;
}

/**
 * Arranca todos los intervalos. Idempotente (no crea duplicados).
 */
export function startCleanupScheduler(): void {
  if (tmpSweepInterval || sessionSweepInterval || playDlSweepInterval) return;

  // Ejecutar una vez al arrancar (después de un pequeño delay para no competir con el boot)
  setTimeout(() => {
    void runTmpSweep();
    void runPlayDlSweep();
    void runSessionSweep();
  }, 60 * 1000);

  tmpSweepInterval = setInterval(() => { void runTmpSweep(); }, 15 * 60 * 1000);
  playDlSweepInterval = setInterval(() => { void runPlayDlSweep(); }, 60 * 60 * 1000);
  sessionSweepInterval = setInterval(() => { void runSessionSweep(); }, 24 * 60 * 60 * 1000);

  console.log(chalk.green('🧹 Cleanup scheduler iniciado (tmp/15m, play-dl/1h, session/24h)'));
}

/**
 * Detiene los intervalos. Llamar en SIGINT/SIGTERM.
 */
export function stopCleanupScheduler(): void {
  if (tmpSweepInterval) { clearInterval(tmpSweepInterval); tmpSweepInterval = null; }
  if (playDlSweepInterval) { clearInterval(playDlSweepInterval); playDlSweepInterval = null; }
  if (sessionSweepInterval) { clearInterval(sessionSweepInterval); sessionSweepInterval = null; }
}
