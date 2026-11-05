import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { log } from './logger.js';
import { sanitizeFilename } from './validate.js';

export type MediaType = 'video' | 'audio' | 'image';

export interface StoredFile {
  path: string;
  filename: string;
  size: number;
  type: MediaType;
  mime: string;
}

export interface StoredEntry {
  token: string;
  dir: string;
  files: StoredFile[];
  createdAt: number;
}

const MIME_BY_EXT: Record<string, { mime: string; type: MediaType }> = {
  mp4: { mime: 'video/mp4', type: 'video' },
  m4v: { mime: 'video/mp4', type: 'video' },
  mov: { mime: 'video/quicktime', type: 'video' },
  webm: { mime: 'video/webm', type: 'video' },
  mkv: { mime: 'video/x-matroska', type: 'video' },
  avi: { mime: 'video/x-msvideo', type: 'video' },
  '3gp': { mime: 'video/3gpp', type: 'video' },
  ts: { mime: 'video/mp2t', type: 'video' },
  mp3: { mime: 'audio/mpeg', type: 'audio' },
  m4a: { mime: 'audio/mp4', type: 'audio' },
  aac: { mime: 'audio/aac', type: 'audio' },
  ogg: { mime: 'audio/ogg', type: 'audio' },
  oga: { mime: 'audio/ogg', type: 'audio' },
  opus: { mime: 'audio/ogg', type: 'audio' },
  wav: { mime: 'audio/wav', type: 'audio' },
  flac: { mime: 'audio/flac', type: 'audio' },
  jpg: { mime: 'image/jpeg', type: 'image' },
  jpeg: { mime: 'image/jpeg', type: 'image' },
  png: { mime: 'image/png', type: 'image' },
  webp: { mime: 'image/webp', type: 'image' },
  gif: { mime: 'image/gif', type: 'image' },
  heic: { mime: 'image/heic', type: 'image' },
  avif: { mime: 'image/avif', type: 'image' },
};

const TEMP_EXTS = new Set(['part', 'ytdl', 'temp', 'tmp', 'json', 'txt', 'description']);

export function classifyFile(filename: string): { mime: string; type: MediaType } | null {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!ext || TEMP_EXTS.has(ext)) return null;
  return MIME_BY_EXT[ext] ?? null;
}

export function extensionForMime(mime: string): string | null {
  const base = mime.split(';')[0].trim().toLowerCase();
  for (const [ext, info] of Object.entries(MIME_BY_EXT)) {
    if (info.mime === base) return ext;
  }
  return null;
}

export const TOKEN_RE = /^[a-f0-9]{32}$/;

export function newToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Registro en memoria de descargas servidas por token, cache por clave de peticion y
 * limpieza periodica del directorio de descargas.
 */
export class FileStore {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly baseDir: string,
    private readonly fileTtlMs: number,
    private readonly cacheTtlMs: number,
  ) {}

  /** Crea el directorio base y elimina todo lo que quedara de ejecuciones anteriores. */
  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const names = await readdir(this.baseDir);
    let removed = 0;
    for (const name of names) {
      await rm(path.join(this.baseDir, name), { recursive: true, force: true });
      removed += 1;
    }
    if (removed) log.info('Limpieza inicial de descargas huerfanas', { removed, dir: this.baseDir });
  }

  startCleanup(intervalMs = 5 * 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.cleanup().catch((err) => log.warn('Fallo la limpieza periodica', { error: String(err) }));
    }, intervalMs);
    this.timer.unref();
  }

  stopCleanup(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Borra carpetas mas viejas que fileTtl y vence entradas de cache. */
  async cleanup(now = Date.now()): Promise<number> {
    let removed = 0;
    let names: string[] = [];
    try {
      names = await readdir(this.baseDir);
    } catch {
      return 0;
    }
    for (const name of names) {
      const full = path.join(this.baseDir, name);
      const entry = this.entries.get(name);
      let age: number;
      if (entry) {
        age = now - entry.createdAt;
      } else {
        try {
          age = now - (await stat(full)).mtimeMs;
        } catch {
          continue;
        }
      }
      if (age > this.fileTtlMs) {
        await rm(full, { recursive: true, force: true });
        this.entries.delete(name);
        removed += 1;
      }
    }
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= now || !this.entries.has(value.token)) this.cache.delete(key);
    }
    if (removed) log.info('Limpieza de descargas vencidas', { removed });
    return removed;
  }

  async createDir(token: string): Promise<string> {
    const dir = path.join(this.baseDir, token);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async discard(token: string): Promise<void> {
    this.entries.delete(token);
    await rm(path.join(this.baseDir, token), { recursive: true, force: true });
  }

  /** Escanea el directorio del token y registra los archivos de media que contiene. */
  async collect(token: string, dir: string): Promise<StoredFile[]> {
    const names = (await readdir(dir)).sort();
    const files: StoredFile[] = [];
    for (const name of names) {
      const info = classifyFile(name);
      if (!info) continue;
      const full = path.join(dir, name);
      const st = await stat(full);
      if (!st.isFile() || st.size === 0) continue;
      files.push({ path: full, filename: sanitizeFilename(name), size: st.size, type: info.type, mime: info.mime });
    }
    return files;
  }

  register(token: string, dir: string, files: StoredFile[], cacheKey?: string): StoredEntry {
    const entry: StoredEntry = { token, dir, files, createdAt: Date.now() };
    this.entries.set(token, entry);
    if (cacheKey && this.cacheTtlMs > 0) {
      this.cache.set(cacheKey, { token, expiresAt: Date.now() + Math.min(this.cacheTtlMs, this.fileTtlMs) });
    }
    return entry;
  }

  get(token: string): StoredEntry | null {
    return this.entries.get(token) ?? null;
  }

  fromCache(cacheKey: string): StoredEntry | null {
    const hit = this.cache.get(cacheKey);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    const entry = this.entries.get(hit.token);
    if (!entry) {
      this.cache.delete(cacheKey);
      return null;
    }
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}

export function cacheKey(url: string, quality: string, audioOnly: boolean): string {
  return `${audioOnly ? 'a' : 'v'}|${quality}|${url}`;
}

export function publicFileUrl(publicUrl: string, token: string, index: number): string {
  return index === 0 ? `${publicUrl}/files/${token}` : `${publicUrl}/files/${token}/${index}`;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Sirve un archivo con soporte de Range (una sola parte) y cabeceras de descarga. */
export function serveFile(req: IncomingMessage, res: ServerResponse, file: StoredFile): number {
  const headers: Record<string, string> = {
    'Content-Type': file.mime,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(file.filename),
    'Cache-Control': 'private, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  };
  let start = 0;
  let end = file.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      res.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
      res.end();
      return 416;
    }
    if (match[1] === '') {
      // Sufijo: los ultimos N bytes.
      const suffix = Number.parseInt(match[2], 10);
      start = Math.max(0, file.size - suffix);
    } else {
      start = Number.parseInt(match[1], 10);
      if (match[2] !== '') end = Math.min(Number.parseInt(match[2], 10), file.size - 1);
    }
    if (start > end || start >= file.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
      res.end();
      return 416;
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD') {
    res.end();
    return status;
  }
  const stream = createReadStream(file.path, { start, end });
  stream.on('error', (err) => {
    log.warn('Error leyendo archivo', { path: file.path, error: err.message });
    res.destroy();
  });
  stream.pipe(res);
  return status;
}
