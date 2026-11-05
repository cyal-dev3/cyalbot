import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  apiKey: string | null;
  ytdlpPath: string;
  ffmpegPath: string;
  gallerydlPath: string | null;
  cookiesPath: string | null;
  extractorArgs: string | null;
  downloadDir: string;
  maxFileBytes: number;
  downloadTimeoutMs: number;
  maxConcurrent: number;
  queueMax: number;
  cacheTtlMs: number;
  fileTtlMs: number;
  logLevel: LogLevel;
  version: string;
}

type Env = Record<string, string | undefined>;

function envInt(env: Env, name: string, def: number, min = 1): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`Variable ${name} invalida: "${raw}" (entero >= ${min})`);
  }
  return n;
}

function envStr(env: Env, name: string, def: string): string {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? def : raw.trim();
}

function envOpt(env: Env, name: string): string | null {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function loadConfig(env: Env = process.env): Config {
  const port = envInt(env, 'PORT', 3002, 0);
  const level = envStr(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new Error(`LOG_LEVEL invalido: "${level}"`);
  }
  return {
    port,
    host: envStr(env, 'HOST', '0.0.0.0'),
    publicUrl: envStr(env, 'PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
    apiKey: envOpt(env, 'DOWNLOADER_API_KEY'),
    ytdlpPath: envStr(env, 'YTDLP_PATH', 'yt-dlp'),
    ffmpegPath: envStr(env, 'FFMPEG_PATH', 'ffmpeg'),
    gallerydlPath: envOpt(env, 'GALLERYDL_PATH'),
    cookiesPath: envOpt(env, 'YTDLP_COOKIES'),
    extractorArgs: envOpt(env, 'YTDLP_EXTRACTOR_ARGS'),
    downloadDir: envStr(env, 'DOWNLOAD_DIR', path.join(os.tmpdir(), 'cyalbot-downloader')),
    maxFileBytes: envInt(env, 'MAX_FILE_MB', 60) * 1024 * 1024,
    downloadTimeoutMs: envInt(env, 'DOWNLOAD_TIMEOUT_MS', 120_000, 1000),
    maxConcurrent: envInt(env, 'MAX_CONCURRENT', 2),
    queueMax: envInt(env, 'QUEUE_MAX', 20, 0),
    cacheTtlMs: envInt(env, 'CACHE_TTL_MIN', 30, 0) * 60_000,
    fileTtlMs: envInt(env, 'FILE_TTL_MIN', 30) * 60_000,
    logLevel: level as LogLevel,
    version: readVersion(),
  };
}
