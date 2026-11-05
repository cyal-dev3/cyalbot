import { execFile } from 'node:child_process';
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import { DownloadError, mapYtdlpError } from './errors.js';
import { extensionForMime } from './files.js';
import { log } from './logger.js';

export type Quality = 'best' | 'medium' | 'low';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Presupuesto de tiempo compartido por todos los pasos de una misma peticion. */
export class Deadline {
  private readonly endsAt: number;

  constructor(totalMs: number) {
    this.endsAt = Date.now() + totalMs;
  }

  remaining(): number {
    return Math.max(0, this.endsAt - Date.now());
  }

  assertAlive(): void {
    if (this.remaining() <= 0) throw new DownloadError('TIMEOUT', 'La descarga supero el tiempo maximo');
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Ejecuta un binario sin shell. Al vencer el timeout envia SIGTERM y, si no muere en 3 s, SIGKILL,
 * y rechaza con TIMEOUT. Nunca lanza por codigo de salida distinto de cero: eso lo decide quien llama.
 */
export function runProcess(bin: string, args: string[], timeoutMs: number, label = path.basename(bin)): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (timeoutMs <= 0) {
      reject(new DownloadError('TIMEOUT', 'La descarga supero el tiempo maximo'));
      return;
    }
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    const started = Date.now();
    const child = execFile(
      bin,
      args,
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        const ms = Date.now() - started;
        if (timedOut) {
          log.warn('Proceso terminado por timeout', { bin: label, ms });
          reject(new DownloadError('TIMEOUT', `${label} supero el tiempo maximo (${Math.round(timeoutMs / 1000)} s)`));
          return;
        }
        const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        if (err && err.code === 'ENOENT') {
          reject(new DownloadError('INTERNAL', `No se encontro el binario "${bin}"`));
          return;
        }
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        log.debug('Proceso finalizado', { bin: label, code, ms });
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
        else if (child.exitCode === null) child.kill('SIGKILL');
      }, 3000);
    }, timeoutMs);
  });
}

export function formatSelector(quality: Quality, audioOnly: boolean): string {
  if (audioOnly) return 'ba/b';
  switch (quality) {
    case 'best':
      return 'bv*+ba/b';
    case 'low':
      return 'bv*[height<=480]+ba/b[height<=480]/b';
    case 'medium':
    default:
      return 'bv*[height<=720]+ba/b[height<=720]/b';
  }
}

// Opciones que solo existen en yt-dlp recientes (>= 2025.10). Se activan si la sonda las acepta.
const JS_RUNTIME_ARGS = ['--js-runtimes', 'node', '--remote-components', 'ejs:github'];
let jsRuntimeSupported: boolean | null = null;

/**
 * Comprueba una vez si yt-dlp acepta usar Node como runtime JS para los desafios de YouTube.
 * Sin esto, yt-dlp avisa de formatos faltantes; con yt-dlp antiguo las opciones no existen y se omiten.
 */
export async function detectCapabilities(config: Config): Promise<void> {
  if (jsRuntimeSupported !== null) return;
  try {
    const result = await runProcess(config.ytdlpPath, [...JS_RUNTIME_ARGS, '--version'], 15_000, 'yt-dlp');
    jsRuntimeSupported = result.code === 0;
  } catch {
    jsRuntimeSupported = false;
  }
  log.info('Capacidades de yt-dlp', { jsRuntimeNode: jsRuntimeSupported });
}

export function resetCapabilities(): void {
  jsRuntimeSupported = null;
}

export function commonArgs(config: Config, options: { warnings?: boolean } = {}): string[] {
  const args = [
    '--no-progress',
    '--no-colors',
    '--socket-timeout',
    '20',
    '--retries',
    '2',
    '--fragment-retries',
    '2',
    '--user-agent',
    USER_AGENT,
  ];
  if (!options.warnings) args.push('--no-warnings');
  if (jsRuntimeSupported) args.push(...JS_RUNTIME_ARGS);
  if (config.cookiesPath) args.push('--cookies', config.cookiesPath);
  if (config.extractorArgs) args.push('--extractor-args', config.extractorArgs);
  if (config.ffmpegPath !== 'ffmpeg') args.push('--ffmpeg-location', config.ffmpegPath);
  return args;
}

export interface YtdlpFormat {
  format_id?: string;
  vcodec?: string | null;
  acodec?: string | null;
  ext?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
  url?: string;
}

export interface YtdlpInfo extends YtdlpFormat {
  _type?: string;
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  uploader_id?: string;
  creator?: string;
  duration?: number | null;
  thumbnail?: string | null;
  thumbnails?: { url: string; width?: number; height?: number; preference?: number }[];
  webpage_url?: string;
  extractor_key?: string;
  extractor?: string;
  ie_key?: string;
  formats?: YtdlpFormat[];
  requested_formats?: YtdlpFormat[];
  entries?: (YtdlpInfo | null)[];
  playlist_count?: number;
  display_url?: string;
}

export interface Metadata {
  title: string | null;
  author: string | null;
  duration: number | null;
  thumbnail: string | null;
  platform: string | null;
  isPlaylist: boolean;
  entries: number;
}

function parseJsonOutput(stdout: string): YtdlpInfo {
  // yt-dlp puede imprimir lineas informativas antes del JSON; se busca la ultima linea que parsee.
  const lines = stdout.split('\n').filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]) as YtdlpInfo;
    } catch {
      continue;
    }
  }
  throw new DownloadError('INTERNAL', 'yt-dlp no devolvio metadata valida');
}

async function runYtdlp(config: Config, args: string[], deadline: Deadline): Promise<RunResult> {
  deadline.assertAlive();
  const result = await runProcess(config.ytdlpPath, args, deadline.remaining(), 'yt-dlp');
  if (result.code !== 0) {
    throw mapYtdlpError(`${result.stderr}\n${result.stdout}`);
  }
  return result;
}

let cachedVersion: { value: string | null; at: number } | null = null;

export async function getYtdlpVersion(config: Config): Promise<string | null> {
  if (cachedVersion && Date.now() - cachedVersion.at < 60_000) return cachedVersion.value;
  let value: string | null = null;
  try {
    const result = await runProcess(config.ytdlpPath, ['--version'], 10_000, 'yt-dlp');
    value = result.code === 0 ? result.stdout.trim() || null : null;
  } catch {
    value = null;
  }
  cachedVersion = { value, at: Date.now() };
  return value;
}

export interface InfoOptions {
  playlist: boolean;
  format?: string;
}

export interface InfoResult {
  info: YtdlpInfo;
  /** stderr del -J: con --ignore-no-formats-error los errores reales llegan como WARNING. */
  warnings: string;
}

/** Obtiene metadata sin descargar. Con `format` incluye requested_formats para estimar tamano y codecs. */
export async function fetchInfo(config: Config, url: string, options: InfoOptions, deadline: Deadline): Promise<InfoResult> {
  await detectCapabilities(config);
  const args = [...commonArgs(config, { warnings: true }), '-J', '--ignore-no-formats-error'];
  if (!options.playlist) args.push('--no-playlist');
  else args.push('--flat-playlist');
  if (options.format) args.push('-f', options.format, '-S', 'vcodec:h264,res,acodec:m4a');
  args.push('--', url);
  const result = await runYtdlp(config, args, deadline);
  return { info: parseJsonOutput(result.stdout), warnings: result.stderr };
}

/** Si los avisos del -J describen un fallo concreto (no encontrado, login, limite), lo devuelve; si no, null. */
export function errorFromWarnings(warnings: string): DownloadError | null {
  const relevant = warnings
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^WARNING:/i.test(l) && !/javascript runtime|challenge|po token|visitor data|generic title|no video formats found|requested format is not available/i.test(l));
  // Se evaluan de la ultima a la primera: el veredicto final del extractor ("Video unavailable")
  // pesa mas que un aviso transitorio anterior (un 429 reintentado, por ejemplo).
  for (const line of relevant.reverse()) {
    const mapped = mapYtdlpError(line);
    if (['NOT_FOUND', 'LOGIN_REQUIRED', 'RATE_LIMITED', 'TOO_LARGE', 'TIMEOUT'].includes(mapped.code)) return mapped;
  }
  return null;
}

export function normalizeMetadata(info: YtdlpInfo): Metadata {
  const entries = (info.entries ?? []).filter((e): e is YtdlpInfo => Boolean(e));
  const first = entries[0];
  const isPlaylist = info._type === 'playlist' || info._type === 'multi_video';
  const platform = (info.extractor_key ?? info.ie_key ?? info.extractor ?? first?.extractor_key ?? null)?.toString() ?? null;
  return {
    title: info.title ?? first?.title ?? null,
    author: pickAuthor(info) ?? (first ? pickAuthor(first) : null),
    duration: toNumber(info.duration) ?? (first ? toNumber(first.duration) : null),
    thumbnail: pickThumbnail(info) ?? (first ? pickThumbnail(first) : null),
    platform: platform ? platform.toLowerCase().replace(/(tab|ie)$/, '') : null,
    isPlaylist,
    entries: isPlaylist ? (info.playlist_count ?? entries.length) : 1,
  };
}

function pickAuthor(info: YtdlpInfo): string | null {
  return info.uploader ?? info.channel ?? info.creator ?? info.uploader_id ?? null;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

export function pickThumbnail(info: YtdlpInfo): string | null {
  if (typeof info.thumbnail === 'string' && info.thumbnail) return info.thumbnail;
  const thumbs = (info.thumbnails ?? []).filter((t) => t && typeof t.url === 'string');
  if (!thumbs.length) return null;
  // La ultima suele ser la mayor; si hay anchos se usa el mayor explicitamente.
  const sorted = [...thumbs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0) || (a.preference ?? 0) - (b.preference ?? 0));
  return sorted[sorted.length - 1].url;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  author: string | null;
  thumbnail: string | null;
}

export async function searchYoutube(config: Config, query: string, limit: number, deadline: Deadline): Promise<SearchResult[]> {
  const clean = query.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (!clean) throw new DownloadError('BAD_REQUEST', 'Falta el parametro "q"');
  const n = Math.min(Math.max(1, limit), 20);
  await detectCapabilities(config);
  const args = [...commonArgs(config), '--flat-playlist', '-J', '--', `ytsearch${n}:${clean}`];
  const result = await runYtdlp(config, args, deadline);
  const info = parseJsonOutput(result.stdout);
  const entries = (info.entries ?? []).filter((e): e is YtdlpInfo => Boolean(e && e.id));
  return entries.slice(0, n).map((e) => ({
    id: String(e.id),
    title: e.title ?? '',
    url: e.webpage_url ?? e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
    duration: toNumber(e.duration),
    author: pickAuthor(e),
    thumbnail: pickThumbnail(e),
  }));
}

/** Suma de tamanos conocidos (exactos o aproximados) de los formatos que se van a descargar. */
export function estimatedSize(info: YtdlpInfo): number | null {
  const items = info._type === 'playlist' ? (info.entries ?? []).filter((e): e is YtdlpInfo => Boolean(e)) : [info];
  let total = 0;
  let known = false;
  for (const item of items) {
    const formats = item.requested_formats?.length ? item.requested_formats : [item];
    for (const f of formats) {
      const size = f.filesize ?? f.filesize_approx;
      if (typeof size === 'number' && size > 0) {
        total += size;
        known = true;
      }
    }
  }
  return known ? total : null;
}

export function hasVideoFormats(info: YtdlpInfo): boolean {
  const items = info._type === 'playlist' ? (info.entries ?? []).filter((e): e is YtdlpInfo => Boolean(e)) : [info];
  return items.some((item) => (item.requested_formats?.length ?? 0) > 0 || (item.formats?.length ?? 0) > 0 || Boolean(item.format_id));
}

export interface DownloadOptions {
  url: string;
  outDir: string;
  quality: Quality;
  audioOnly: boolean;
}

export async function downloadWithYtdlp(config: Config, options: DownloadOptions, deadline: Deadline): Promise<void> {
  await detectCapabilities(config);
  const args = [
    ...commonArgs(config),
    '--no-playlist',
    '--restrict-filenames',
    '--max-filesize',
    `${Math.floor(config.maxFileBytes / (1024 * 1024))}M`,
    '-o',
    path.join(options.outDir, '%(id)s.%(ext)s'),
    '-f',
    formatSelector(options.quality, options.audioOnly),
  ];
  if (options.audioOnly) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
  } else {
    args.push('-S', 'vcodec:h264,res,acodec:m4a', '--merge-output-format', 'mp4', '--remux-video', 'mp4');
  }
  args.push('--', options.url);
  const result = await runYtdlp(config, args, deadline);
  // yt-dlp sale con 0 cuando aborta por max-filesize; el aviso va a stdout.
  if (/larger than max-filesize/i.test(result.stdout + result.stderr)) {
    throw new DownloadError('TOO_LARGE', `El archivo supera el maximo de ${Math.floor(config.maxFileBytes / (1024 * 1024))} MB`);
  }
}

interface Codecs {
  video: string | null;
  audio: string | null;
}

function ffprobePath(ffmpegPath: string): string {
  const dir = path.dirname(ffmpegPath);
  const base = path.basename(ffmpegPath).replace(/ffmpeg/i, 'ffprobe');
  return dir === '.' && !ffmpegPath.includes(path.sep) ? base : path.join(dir, base);
}

async function probeCodecs(config: Config, file: string, deadline: Deadline): Promise<Codecs | null> {
  try {
    const result = await runProcess(
      ffprobePath(config.ffmpegPath),
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file],
      Math.min(deadline.remaining(), 20_000),
      'ffprobe',
    );
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as { streams?: { codec_type?: string; codec_name?: string }[] };
    const video = parsed.streams?.find((s) => s.codec_type === 'video')?.codec_name ?? null;
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio')?.codec_name ?? null;
    return { video, audio };
  } catch {
    return null;
  }
}

function codecsFromInfo(info: YtdlpInfo): Codecs {
  const formats = info.requested_formats?.length ? info.requested_formats : [info];
  const video = formats.map((f) => f.vcodec).find((v) => v && v !== 'none') ?? null;
  const audio = formats.map((f) => f.acodec).find((a) => a && a !== 'none') ?? null;
  return { video: video ?? null, audio: audio ?? null };
}

function isH264(codec: string | null): boolean {
  return !!codec && /^(h264|avc1?)/i.test(codec);
}

function isAac(codec: string | null): boolean {
  return !!codec && /^(aac|mp4a)/i.test(codec);
}

/**
 * Garantiza H.264/AAC en mp4 para que WhatsApp lo reproduzca. Solo recodifica las pistas que lo
 * necesiten: video a libx264 si no es h264, audio a aac si no es aac. Si todo esta bien no toca el archivo.
 */
export async function ensureWhatsappCompatible(config: Config, file: string, info: YtdlpInfo, deadline: Deadline): Promise<string> {
  const probed = await probeCodecs(config, file, deadline);
  const codecs = probed ?? codecsFromInfo(info);
  const videoOk = codecs.video === null ? true : isH264(codecs.video);
  const audioOk = codecs.audio === null ? true : isAac(codecs.audio);
  const isMp4 = path.extname(file).toLowerCase() === '.mp4';
  if (videoOk && audioOk && isMp4) return file;

  deadline.assertAlive();
  const target = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.mp4`);
  const tmp = path.join(path.dirname(file), `recode-${process.pid}.tmp.mp4`);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', file];
  args.push('-c:v', videoOk ? 'copy' : 'libx264');
  if (!videoOk) args.push('-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p');
  args.push('-c:a', audioOk ? 'copy' : 'aac');
  if (!audioOk) args.push('-b:a', '128k');
  args.push('-movflags', '+faststart', tmp);
  log.info('Recodificando para WhatsApp', { video: codecs.video, audio: codecs.audio, file: path.basename(file) });
  const result = await runProcess(config.ffmpegPath, args, deadline.remaining(), 'ffmpeg');
  if (result.code !== 0) {
    await rm(tmp, { force: true });
    throw new DownloadError('INTERNAL', `ffmpeg fallo al recodificar: ${result.stderr.trim().split('\n').pop() ?? ''}`);
  }
  await rm(file, { force: true });
  await rename(tmp, target);
  const size = (await stat(target)).size;
  if (size > config.maxFileBytes) {
    await rm(target, { force: true });
    throw new DownloadError('TOO_LARGE', 'El archivo recodificado supera el tamano maximo');
  }
  return target;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|avif)(?:[?#].*)?$/i;

// Plataformas donde un post sin formatos de video suele ser una foto y la miniatura es la imagen real.
// En plataformas de video (YouTube, TikTok) una miniatura sin formatos significa fallo de extraccion.
const IMAGE_PLATFORMS = /instagram|pinterest|threads|twitter|facebook|reddit|tumblr|imgur|bluesky|generic|weibo|vk/i;

/** URLs de imagen candidatas cuando yt-dlp no ofrece formatos de video (posts de fotos). */
export function collectImageUrls(info: YtdlpInfo): string[] {
  const items = info._type === 'playlist' ? (info.entries ?? []).filter((e): e is YtdlpInfo => Boolean(e)) : [info];
  const platform = String(info.extractor_key ?? info.ie_key ?? info.extractor ?? '');
  const urls: string[] = [];
  for (const item of items) {
    const hasVideo = (item.formats?.length ?? 0) > 0 || (item.requested_formats?.length ?? 0) > 0;
    if (hasVideo) continue;
    const direct = [item.display_url, item.url].find((u) => typeof u === 'string' && IMAGE_EXT_RE.test(u));
    const byExt = item.ext && /^(jpe?g|png|webp)$/i.test(item.ext) && item.url ? item.url : null;
    const itemPlatform = String(item.extractor_key ?? item.ie_key ?? item.extractor ?? platform);
    const thumb = IMAGE_PLATFORMS.test(itemPlatform) && item.duration == null ? pickThumbnail(item) : null;
    const candidate = direct ?? byExt ?? thumb;
    if (candidate && /^https?:\/\//i.test(candidate) && !urls.includes(candidate)) urls.push(candidate);
  }
  return urls;
}

/** Descarga imagenes con fetch nativo al directorio indicado. Devuelve cuantas se guardaron. */
export async function downloadImages(config: Config, urls: string[], outDir: string, deadline: Deadline, baseId = 'image'): Promise<number> {
  let saved = 0;
  for (const [index, url] of urls.entries()) {
    deadline.assertAlive();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'image/*,*/*;q=0.8' },
        signal: AbortSignal.timeout(Math.min(deadline.remaining(), 30_000)),
        redirect: 'follow',
      });
      if (!res.ok) {
        log.debug('Imagen no descargable', { url, status: res.status });
        continue;
      }
      const mime = res.headers.get('content-type') ?? '';
      if (!mime.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > config.maxFileBytes) continue;
      const ext = extensionForMime(mime) ?? 'jpg';
      const name = urls.length === 1 ? `${baseId}.${ext}` : `${baseId}-${String(index + 1).padStart(2, '0')}.${ext}`;
      await writeFile(path.join(outDir, name), buf);
      saved += 1;
    } catch (err) {
      log.debug('Fallo descargando imagen', { url, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return saved;
}

/** Ejecuta gallery-dl si esta configurado. Devuelve false si no esta disponible. */
export async function downloadWithGalleryDl(config: Config, url: string, outDir: string, deadline: Deadline): Promise<boolean> {
  if (!config.gallerydlPath) return false;
  const args = ['-D', outDir, '-o', 'metadata=false', '-q'];
  if (config.cookiesPath) args.push('--cookies', config.cookiesPath);
  args.push(url);
  deadline.assertAlive();
  const result = await runProcess(config.gallerydlPath, args, deadline.remaining(), 'gallery-dl');
  if (result.code !== 0) {
    log.info('gallery-dl fallo', { code: result.code, error: result.stderr.trim().split('\n').pop() });
    return false;
  }
  return true;
}
