import { CONFIG } from '../config.js';
import { fetchTextWithTimeout } from './http.js';
import { createLogger } from './logger.js';

const log = createLogger('downloads');

export type DownloadErrorCode =
  | 'INVALID_URL'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'TOO_LARGE'
  | 'UNSUPPORTED'
  | 'LOGIN_REQUIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'TIMEOUT';

export type RemoteMediaType = 'video' | 'audio' | 'image';
export type Quality = 'best' | 'medium' | 'low';

export interface RemoteMedia {
  url: string;
  type: RemoteMediaType;
  filename: string;
  size: number;
}

export interface DownloadData extends RemoteMedia {
  duration: number | null;
  thumbnail: string | null;
  title: string | null;
  author: string | null;
  medias: RemoteMedia[];
}

export interface InfoData {
  title: string | null;
  author: string | null;
  duration: number | null;
  thumbnail: string | null;
  platform: string | null;
  isPlaylist: boolean;
  entries: number;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  duration: number | null;
  author: string | null;
  thumbnail: string | null;
}

export interface HealthData {
  status: string;
  version: string;
  ytdlp: string | null;
  uptimeSeconds: number;
  queue: { active: number; waiting: number };
}

export interface ClientFailure {
  success: false;
  code: DownloadErrorCode;
  message: string;
  /** Status HTTP cuando hubo respuesta del servicio. */
  status?: number;
}

export type ClientResult<T> = { success: true; data: T } | ClientFailure;

export interface DownloadOptions {
  audioOnly?: boolean;
  quality?: Quality;
}

/** Fuentes de búsqueda que el servicio implementa hoy (solo ytsearch). */
export const SEARCH_SOURCES = ['youtube'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number] | 'soundcloud';

export interface SearchOptions {
  limit?: number;
  source?: SearchSource;
}

export const MAX_FILE_MB = 60;
export const NOT_CONFIGURED_MESSAGE = 'Las descargas no están configuradas en este bot (DOWNLOADER_API_URL).';

const KNOWN_CODES = new Set<DownloadErrorCode>([
  'INVALID_URL', 'BAD_REQUEST', 'UNAUTHORIZED', 'NOT_FOUND', 'TOO_LARGE',
  'UNSUPPORTED', 'LOGIN_REQUIRED', 'RATE_LIMITED', 'INTERNAL', 'TIMEOUT',
]);

function baseUrl(): string {
  return CONFIG.downloaderApi.url.replace(/\/+$/, '');
}

export function isDownloaderConfigured(): boolean {
  return baseUrl().length > 0;
}

/** Las descargas reales tardan: nunca menos de 120 s aunque el .env diga menos. */
function downloadTimeoutMs(): number {
  return Math.max(CONFIG.downloaderApi.timeout, 120_000);
}

function authHeaders(): Record<string, string> {
  const key = process.env.DOWNLOADER_API_KEY;
  return key ? { 'x-api-key': key } : {};
}

function notConfigured(): ClientFailure {
  return { success: false, code: 'INTERNAL', message: NOT_CONFIGURED_MESSAGE };
}

/** Fallo de red o de tiempo (incluida la lectura del cuerpo): TIMEOUT si lo abortó el timer. */
function connectionFailure(path: string, error: unknown, timeoutMs: number): ClientFailure {
  const aborted = isAbortError(error);
  log.warn(`${path}: ${aborted ? 'timeout' : 'sin conexión'}`, aborted ? '' : (error instanceof Error ? error.message : error));
  return aborted
    ? { success: false, code: 'TIMEOUT', message: `El servicio de descargas no respondió en ${Math.round(timeoutMs / 1000)} s` }
    : { success: false, code: 'INTERNAL', message: 'No se pudo conectar con el servicio de descargas' };
}

/** undici señala el abort con AbortError, a veces envuelto como `cause` de otro error. */
function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error && cause.name === 'AbortError';
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: unknown; message?: unknown };
}

async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<ClientResult<T>> {
  if (!isDownloaderConfigured()) return notConfigured();
  const url = `${baseUrl()}${path}`;
  let response: Response;
  let text: string;
  try {
    ({ response, text } = await fetchTextWithTimeout(url, {
      ...init,
      timeoutMs,
      headers: { accept: 'application/json', ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    }));
  } catch (error) {
    return connectionFailure(path, error, timeoutMs);
  }

  let body: Envelope | null = null;
  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    body = null;
  }

  if (!body || typeof body !== 'object') {
    log.warn(`${path}: respuesta no JSON (HTTP ${response.status})`);
    return { success: false, code: 'INTERNAL', status: response.status, message: `El servicio de descargas devolvió una respuesta inválida (HTTP ${response.status})` };
  }
  if (!response.ok || body.success !== true || body.data === undefined) {
    const rawCode = body.error?.code;
    const code: DownloadErrorCode = typeof rawCode === 'string' && KNOWN_CODES.has(rawCode as DownloadErrorCode)
      ? (rawCode as DownloadErrorCode)
      : 'INTERNAL';
    const message = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`;
    log.debug(`${path}: ${code} (${response.status}) ${message}`);
    return { success: false, code, message, status: response.status };
  }
  return { success: true, data: body.data as T };
}

function toMedia(raw: unknown): RemoteMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.url !== 'string') return null;
  const type: RemoteMediaType = m.type === 'audio' || m.type === 'image' ? m.type : 'video';
  return {
    url: m.url,
    type,
    filename: typeof m.filename === 'string' ? m.filename : '',
    size: typeof m.size === 'number' && Number.isFinite(m.size) ? m.size : 0,
  };
}

/** POST /v1/download. `audioOnly` produce mp3; `quality` por defecto medium (<= 720p). */
export async function downloadMedia(url: string, options: DownloadOptions = {}): Promise<ClientResult<DownloadData>> {
  const result = await request<Record<string, unknown>>(
    '/v1/download',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, quality: options.quality ?? 'medium', audioOnly: options.audioOnly ?? false }),
    },
    downloadTimeoutMs(),
  );
  if (!result.success) return result;

  const raw = result.data;
  const first = toMedia(raw);
  const medias = Array.isArray(raw.medias) ? raw.medias.map(toMedia).filter((m): m is RemoteMedia => m !== null) : [];
  if (!first && medias.length === 0) {
    return { success: false, code: 'INTERNAL', message: 'El servicio no devolvió ningún archivo' };
  }
  const head = first ?? medias[0];
  return {
    success: true,
    data: {
      ...head,
      medias: medias.length ? medias : [head],
      duration: typeof raw.duration === 'number' ? raw.duration : null,
      thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
      title: typeof raw.title === 'string' ? raw.title : null,
      author: typeof raw.author === 'string' ? raw.author : null,
    },
  };
}

/** POST /v1/info: metadata sin descargar. */
export async function getInfo(url: string): Promise<ClientResult<InfoData>> {
  const result = await request<Record<string, unknown>>(
    '/v1/info',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) },
    60_000,
  );
  if (!result.success) return result;
  const raw = result.data;
  return {
    success: true,
    data: {
      title: typeof raw.title === 'string' ? raw.title : null,
      author: typeof raw.author === 'string' ? raw.author : null,
      duration: typeof raw.duration === 'number' ? raw.duration : null,
      thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
      platform: typeof raw.platform === 'string' ? raw.platform : null,
      isPlaylist: raw.isPlaylist === true,
      entries: typeof raw.entries === 'number' ? raw.entries : 0,
    },
  };
}

/** GET /v1/search. Hoy el servicio solo busca en YouTube; otras fuentes devuelven UNSUPPORTED sin llamar. */
export async function search(query: string, options: SearchOptions = {}): Promise<ClientResult<SearchResult[]>> {
  const source = options.source ?? 'youtube';
  if (!(SEARCH_SOURCES as readonly string[]).includes(source)) {
    return { success: false, code: 'UNSUPPORTED', message: `La búsqueda en ${source} no está disponible en el servicio de descargas` };
  }
  const params = new URLSearchParams({ q: query });
  if (options.limit) params.set('limit', String(Math.min(20, Math.max(1, Math.floor(options.limit)))));
  const result = await request<{ results?: unknown }>(`/v1/search?${params.toString()}`, { method: 'GET' }, 60_000);
  if (!result.success) return result;
  const list = Array.isArray(result.data.results) ? result.data.results : [];
  const results: SearchResult[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.url !== 'string') continue;
    results.push({
      id: typeof r.id === 'string' ? r.id : '',
      title: typeof r.title === 'string' ? r.title : 'Sin título',
      url: r.url,
      duration: typeof r.duration === 'number' ? r.duration : null,
      author: typeof r.author === 'string' ? r.author : null,
      thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : null,
    });
  }
  return { success: true, data: results };
}

/** GET /health. No exige api key; falla rápido (5 s). */
export async function health(): Promise<ClientResult<HealthData>> {
  if (!isDownloaderConfigured()) return notConfigured();
  const timeoutMs = 5_000;
  let response: Response;
  let text: string;
  try {
    ({ response, text } = await fetchTextWithTimeout(`${baseUrl()}/health`, { timeoutMs }));
  } catch (error) {
    return connectionFailure('/health', error, timeoutMs);
  }
  if (!response.ok) return { success: false, code: 'INTERNAL', status: response.status, message: `HTTP ${response.status}` };
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const queue = (raw.queue && typeof raw.queue === 'object' ? raw.queue : {}) as Record<string, unknown>;
    return {
      success: true,
      data: {
        status: typeof raw.status === 'string' ? raw.status : 'unknown',
        version: typeof raw.version === 'string' ? raw.version : '?',
        ytdlp: typeof raw.ytdlp === 'string' ? raw.ytdlp : null,
        uptimeSeconds: typeof raw.uptimeSeconds === 'number' ? raw.uptimeSeconds : 0,
        queue: {
          active: typeof queue.active === 'number' ? queue.active : 0,
          waiting: typeof queue.waiting === 'number' ? queue.waiting : 0,
        },
      },
    };
  } catch {
    return { success: false, code: 'INTERNAL', status: response.status, message: 'El servicio devolvió un /health que no es JSON' };
  }
}

export interface DescribeExtra {
  /** Mensaje original del servicio (se usa para extraer el tamaño en TOO_LARGE). */
  message?: string;
  /** Tamaño conocido del archivo en bytes, si el bot lo tiene. */
  sizeBytes?: number;
}

/** Texto para el usuario a partir del código del servicio. */
export function describeDownloadError(code: DownloadErrorCode, extra: DescribeExtra = {}): string {
  switch (code) {
    case 'LOGIN_REQUIRED':
      return 'Ese contenido es privado o requiere inicio de sesión.';
    case 'TOO_LARGE': {
      // El servicio solo da el tamaño real con "pesa (unos) N MB"; otros mensajes
      // ("supera el maximo de 60 MB") traen el tope, no el tamaño del archivo.
      const fromMessage = extra.message?.match(/pesa\s+(?:unos\s+)?(\d+)\s*MB/i)?.[1];
      const mb = extra.sizeBytes ? Math.ceil(extra.sizeBytes / (1024 * 1024)) : fromMessage ? Number(fromMessage) : null;
      return mb && mb > MAX_FILE_MB ? `El archivo pesa ${mb} MB, el máximo es ${MAX_FILE_MB} MB.` : `El archivo supera el máximo de ${MAX_FILE_MB} MB.`;
    }
    case 'TIMEOUT':
      return 'La descarga tardó demasiado y se canceló. Intenta de nuevo más tarde.';
    case 'RATE_LIMITED':
      return 'El servicio está saturado o la plataforma limitó las peticiones. Espera un momento.';
    case 'UNSUPPORTED':
      return 'Ese enlace no tiene video ni imágenes que se puedan descargar.';
    case 'NOT_FOUND':
      return 'No se encontró el contenido: puede haber sido eliminado o el enlace es incorrecto.';
    case 'INVALID_URL':
      return 'Ese enlace no es válido.';
    case 'UNAUTHORIZED':
      return 'El bot no tiene autorización en el servicio de descargas (revisa DOWNLOADER_API_KEY).';
    case 'BAD_REQUEST':
      return 'La petición al servicio de descargas no es válida.';
    case 'INTERNAL':
    default:
      return extra.message && extra.message !== NOT_CONFIGURED_MESSAGE
        ? `No se pudo descargar: ${extra.message.slice(0, 160)}`
        : (extra.message ?? 'No se pudo descargar el contenido.');
  }
}

/** Atajo para plugins: texto humano a partir de cualquier fallo del cliente. */
export function describeFailure(failure: ClientFailure): string {
  return describeDownloadError(failure.code, { message: failure.message });
}
