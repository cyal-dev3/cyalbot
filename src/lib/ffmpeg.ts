import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('media');

/** Carpeta de temporales. CONFIG.tmpDir cuando el núcleo la exponga; mientras, TMP_DIR o ./tmp. */
export const TMP_DIR = process.env.TMP_DIR || join(process.cwd(), 'tmp');

const MAX_BUFFER = 4 * 1024 * 1024;
const QUIET_ARGS = ['-hide_banner', '-loglevel', 'error', '-nostdin'];

export interface RunOptions {
  timeoutMs?: number;
}

export class FfmpegError extends Error {
  constructor(readonly tool: 'ffmpeg' | 'ffprobe', message: string, readonly timedOut: boolean) {
    super(message);
    this.name = 'FfmpegError';
  }
}

function run(tool: 'ffmpeg' | 'ffprobe', args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      tool,
      [...QUIET_ARGS, ...args],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        const lastLine = String(stderr || '').trim().split('\n').filter(Boolean).pop();
        const detail = timedOut
          ? `${tool} superó ${Math.round(timeoutMs / 1000)} s`
          : (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? `${tool} no está instalado`
            : lastLine || error.message;
        log.debug(`${tool} falló:`, detail);
        reject(new FfmpegError(tool, detail, timedOut));
      },
    );
  });
}

/** Ejecuta ffmpeg (siempre con -y) y mata el proceso con SIGKILL si supera el tiempo. */
export async function runFfmpeg(args: string[], options: RunOptions = {}): Promise<void> {
  await run('ffmpeg', ['-y', ...args], options.timeoutMs ?? 60_000);
}

/** Ejecuta ffprobe y devuelve stdout. */
export function runFfprobe(args: string[], options: RunOptions = {}): Promise<string> {
  return run('ffprobe', args, options.timeoutMs ?? 15_000);
}

let tmpReady: Promise<void> | null = null;

export function ensureTmpDir(): Promise<void> {
  tmpReady ??= mkdir(TMP_DIR, { recursive: true }).then(() => undefined);
  return tmpReady;
}

/**
 * Crea rutas temporales únicas (una por extensión), ejecuta `fn` con ellas y
 * borra siempre los archivos, existan o no.
 */
export async function withTempFiles<T>(exts: string[], fn: (paths: string[]) => Promise<T>): Promise<T> {
  await ensureTmpDir();
  const id = `${Date.now()}_${randomBytes(4).toString('hex')}`;
  const paths = exts.map((ext, i) => join(TMP_DIR, `${id}_${i}.${ext.replace(/^\./, '')}`));
  try {
    return await fn(paths);
  } finally {
    await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
  }
}
