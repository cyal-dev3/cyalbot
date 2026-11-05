import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.js';
import { DownloadError, toDownloadError } from './errors.js';
import { FileStore, TOKEN_RE, cacheKey, newToken, publicFileUrl, serveFile, type StoredEntry } from './files.js';
import { log } from './logger.js';
import { Queue } from './queue.js';
import { assertPublicHost, validateUrl } from './validate.js';
import {
  Deadline,
  collectImageUrls,
  downloadImages,
  downloadWithGalleryDl,
  downloadWithYtdlp,
  ensureWhatsappCompatible,
  errorFromWarnings,
  estimatedSize,
  fetchInfo,
  formatSelector,
  getYtdlpVersion,
  hasVideoFormats,
  normalizeMetadata,
  searchYoutube,
  type Metadata,
  type Quality,
} from './ytdlp.js';

export interface AppContext {
  config: Config;
  store: FileStore;
  queue: Queue;
  startedAt: number;
}

export interface RequestContext {
  requestId: string;
  startedAt: number;
}

export interface DownloadRequest {
  url: string;
  quality: Quality;
  audioOnly: boolean;
}

export interface MediaOut {
  url: string;
  type: string;
  filename: string;
  size: number;
}

export interface DownloadData extends MediaOut {
  duration: number | null;
  thumbnail: string | null;
  title: string | null;
  author: string | null;
  medias: MediaOut[];
}

const QUALITIES: Quality[] = ['best', 'medium', 'low'];

/** Valida y normaliza el body de /v1/download. */
export function parseDownloadRequest(body: unknown): DownloadRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DownloadError('BAD_REQUEST', 'El body debe ser un objeto JSON');
  }
  const obj = body as Record<string, unknown>;
  const url = validateUrl(obj.url).toString();
  let quality: Quality = 'medium';
  if (obj.quality !== undefined && obj.quality !== null) {
    if (typeof obj.quality !== 'string' || !QUALITIES.includes(obj.quality as Quality)) {
      throw new DownloadError('BAD_REQUEST', 'quality debe ser best, medium o low');
    }
    quality = obj.quality as Quality;
  }
  let audioOnly = false;
  if (obj.audioOnly !== undefined && obj.audioOnly !== null) {
    if (typeof obj.audioOnly !== 'boolean') throw new DownloadError('BAD_REQUEST', 'audioOnly debe ser booleano');
    audioOnly = obj.audioOnly;
  }
  return { url, quality, audioOnly };
}

/** Construye data de la respuesta de /v1/download a partir de los archivos guardados. */
export function buildDownloadData(publicUrl: string, entry: StoredEntry, meta: Metadata | null): DownloadData {
  const medias: MediaOut[] = entry.files.map((f, i) => ({
    url: publicFileUrl(publicUrl, entry.token, i),
    type: f.type,
    filename: f.filename,
    size: f.size,
  }));
  const first = medias[0];
  return {
    ...first,
    duration: meta?.duration ?? null,
    thumbnail: meta?.thumbnail ?? null,
    title: meta?.title ?? null,
    author: meta?.author ?? null,
    medias,
  };
}

interface DownloadOutcome {
  entry: StoredEntry;
  meta: Metadata | null;
  engine: string;
  cached: boolean;
}

export async function handleDownload(app: AppContext, body: unknown, req: RequestContext): Promise<{ data: DownloadData; engine: string; cached: boolean }> {
  const request = parseDownloadRequest(body);
  const key = cacheKey(request.url, request.quality, request.audioOnly);
  const cached = app.store.fromCache(key);
  if (cached) {
    log.debug('Cache hit', { requestId: req.requestId, token: cached.token });
    const meta = metaCache.get(cached.token) ?? null;
    return { data: buildDownloadData(app.config.publicUrl, cached, meta), engine: 'cache', cached: true };
  }
  await assertPublicHost(new URL(request.url).hostname);
  const outcome = await app.queue.run(() => performDownload(app, request, key, req));
  return { data: buildDownloadData(app.config.publicUrl, outcome.entry, outcome.meta), engine: outcome.engine, cached: outcome.cached };
}

// Metadata asociada a cada token para poder responder igual en los aciertos de cache.
const metaCache = new Map<string, Metadata>();

async function performDownload(app: AppContext, request: DownloadRequest, key: string, req: RequestContext): Promise<DownloadOutcome> {
  // Otra peticion identica pudo completarse mientras esta esperaba en la cola.
  const cached = app.store.fromCache(key);
  if (cached) return { entry: cached, meta: metaCache.get(cached.token) ?? null, engine: 'cache', cached: true };

  const { config, store } = app;
  const deadline = new Deadline(config.downloadTimeoutMs);
  const token = newToken();
  const dir = await store.createDir(token);
  let engine = 'yt-dlp';
  try {
    const { info, warnings } = await fetchInfo(config, request.url, { playlist: false, format: formatSelector(request.quality, request.audioOnly) }, deadline);
    const meta = normalizeMetadata(info);
    if (!hasVideoFormats(info)) {
      // Sin formatos, el motivo real (no existe, login, limite) viene como aviso del -J.
      const known = errorFromWarnings(warnings);
      if (known) throw known;
    }
    const estimate = estimatedSize(info);
    if (estimate !== null && estimate > config.maxFileBytes) {
      throw new DownloadError(
        'TOO_LARGE',
        `El archivo pesa unos ${Math.ceil(estimate / (1024 * 1024))} MB y el maximo es ${Math.floor(config.maxFileBytes / (1024 * 1024))} MB`,
      );
    }

    if (hasVideoFormats(info)) {
      await downloadWithYtdlp(config, { url: request.url, outDir: dir, quality: request.quality, audioOnly: request.audioOnly }, deadline);
    }
    let files = await store.collect(token, dir);

    if (!files.length && !request.audioOnly) {
      const imageUrls = collectImageUrls(info);
      if (imageUrls.length) {
        log.debug('Sin video; intentando imagenes', { requestId: req.requestId, count: imageUrls.length });
        await downloadImages(config, imageUrls, dir, deadline, info.id ?? 'image');
        files = await store.collect(token, dir);
      }
      if (!files.length && (await downloadWithGalleryDl(config, request.url, dir, deadline))) {
        engine = 'gallery-dl';
        files = await store.collect(token, dir);
      }
    }

    if (!files.length) {
      throw new DownloadError(
        'UNSUPPORTED',
        request.audioOnly
          ? 'No se pudo extraer audio de esta URL'
          : 'La URL no contiene video ni imagenes descargables (o requiere cookies)',
      );
    }

    for (const file of files) {
      if (file.size > config.maxFileBytes) {
        throw new DownloadError('TOO_LARGE', `El archivo pesa ${Math.ceil(file.size / (1024 * 1024))} MB y el maximo es ${Math.floor(config.maxFileBytes / (1024 * 1024))} MB`);
      }
    }

    if (!request.audioOnly) {
      for (const file of files) {
        if (file.type === 'video') await ensureWhatsappCompatible(config, file.path, info, deadline);
      }
      // La recodificacion puede cambiar nombre y tamano; se vuelve a leer el directorio.
      files = await store.collect(token, dir);
    }

    const entry = store.register(token, dir, files, key);
    metaCache.set(token, meta);
    return { entry, meta, engine, cached: false };
  } catch (err) {
    await store.discard(token).catch(() => undefined);
    throw toDownloadError(err);
  }
}

export async function handleInfo(app: AppContext, body: unknown): Promise<Metadata> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DownloadError('BAD_REQUEST', 'El body debe ser un objeto JSON');
  }
  const url = validateUrl((body as Record<string, unknown>).url).toString();
  await assertPublicHost(new URL(url).hostname);
  const deadline = new Deadline(Math.min(app.config.downloadTimeoutMs, 60_000));
  const { info, warnings } = await fetchInfo(app.config, url, { playlist: true }, deadline);
  if (!hasVideoFormats(info) && !info.entries?.length) {
    const known = errorFromWarnings(warnings);
    if (known) throw known;
  }
  return normalizeMetadata(info);
}

export async function handleSearch(app: AppContext, query: URLSearchParams): Promise<{ results: Awaited<ReturnType<typeof searchYoutube>> }> {
  const q = query.get('q') ?? '';
  const limitRaw = query.get('limit');
  let limit = 5;
  if (limitRaw !== null && limitRaw !== '') {
    limit = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit < 1) throw new DownloadError('BAD_REQUEST', 'limit debe ser un entero positivo');
  }
  const deadline = new Deadline(Math.min(app.config.downloadTimeoutMs, 60_000));
  const results = await searchYoutube(app.config, q, limit, deadline);
  return { results };
}

export async function handleHealth(app: AppContext): Promise<Record<string, unknown>> {
  return {
    status: 'ok',
    version: app.config.version,
    ytdlp: await getYtdlpVersion(app.config),
    uptimeSeconds: Math.floor((Date.now() - app.startedAt) / 1000),
    queue: { active: app.queue.activeCount, waiting: app.queue.waitingCount },
  };
}

/** GET /files/<token>[/<index>]. Devuelve el status enviado o null si la ruta no es de archivos. */
export function handleFiles(app: AppContext, req: IncomingMessage, res: ServerResponse, pathname: string): number | null {
  const match = /^\/files\/([^/]+)(?:\/(\d{1,3}))?\/?$/.exec(pathname);
  if (!match) return null;
  const token = match[1];
  const index = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (!TOKEN_RE.test(token)) {
    return sendError(res, new DownloadError('NOT_FOUND', 'Archivo no encontrado'), null);
  }
  const entry = app.store.get(token);
  const file = entry?.files[index];
  if (!entry || !file) {
    return sendError(res, new DownloadError('NOT_FOUND', 'Archivo no encontrado o expirado'), null);
  }
  return serveFile(req, res, file);
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): number {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
  return status;
}

export function sendError(res: ServerResponse, err: DownloadError, ctx: RequestContext | null): number {
  const meta = ctx ? { engine: 'yt-dlp', requestId: ctx.requestId, durationMs: Date.now() - ctx.startedAt } : undefined;
  return sendJson(res, err.status, {
    success: false,
    error: { code: err.code, message: err.message },
    ...(meta ? { meta } : {}),
  });
}
