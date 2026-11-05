/**
 * Descarga acotada de archivos remotos (video, imagen, audio) para reenviar
 * por WhatsApp: timeout, límite de bytes, validación de respuesta y rechazo
 * de destinos internos (SSRF), salvo la API local de descargas configurada.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CONFIG } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('fetch-media');

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
/** Saltos de redirección que se siguen; cada destino pasa por rejectReason. */
export const MAX_REDIRECTS = 5;

export interface FetchMediaOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Cabeceras extra (algunos CDN exigen User-Agent o Referer). */
  headers?: Record<string, string>;
}

export interface FetchedMedia {
  buffer: Buffer;
  mimetype: string;
}

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/** true si la IP (v4 o v6) es de loopback, privada, de enlace local o no enrutable. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = mappedV4(lower);
    if (mapped) return isPrivateAddress(mapped);
    return false;
  }
  return false;
}

/**
 * IPv4 embebida en una dirección v4-mapped (::ffff:a.b.c.d). El parser de URL
 * la normaliza a hexadecimal (::ffff:7f00:1), así que se aceptan ambas formas.
 */
function mappedV4(ipv6: string): string | null {
  const decimal = ipv6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (decimal) return decimal[1];
  const hex = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** Hosts que nunca se descargan: localhost y literales IP privadas. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  return isIP(host) !== 0 && isPrivateAddress(host);
}

function allowedByConfig(url: URL): boolean {
  if (!CONFIG.downloaderApi.url) return false;
  try {
    const api = new URL(CONFIG.downloaderApi.url);
    return api.hostname.toLowerCase() === url.hostname.toLowerCase();
  } catch {
    return false;
  }
}

async function resolvesToPrivate(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return isPrivateAddress(hostname);
  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.some((a) => isPrivateAddress(a.address));
  } catch {
    // Si no resuelve, fetch fallará por su cuenta.
    return false;
  }
}

/**
 * Comprueba si una URL se puede descargar: http(s), host público (o el de
 * DOWNLOADER_API_URL). Devuelve el motivo del rechazo o null si es válida.
 */
export async function rejectReason(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'URL inválida';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `protocolo no permitido (${url.protocol})`;
  if (allowedByConfig(url)) return null;
  if (isPrivateHost(url.hostname)) return 'host privado';
  if (await resolvesToPrivate(url.hostname)) return 'el host resuelve a una IP privada';
  return null;
}

async function readLimited(res: Response, maxBytes: number, controller: AbortController): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * fetch con redirecciones manuales: cada Location se valida con rejectReason
 * antes de pedirlo, porque un host público puede redirigir a uno interno.
 * Devuelve null si una redirección es inválida o se superan los saltos.
 */
async function fetchFollowing(url: string, init: { signal: AbortSignal; headers?: Record<string, string> }): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get('location');
    await res.body?.cancel();
    if (!location) return res;
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      log.debug(`redirección inválida (${location}) desde ${current}`);
      return null;
    }
    const reason = await rejectReason(next);
    if (reason) {
      log.warn(`redirección rechazada (${reason}): ${current} -> ${next}`);
      return null;
    }
    current = next;
  }
  log.debug(`más de ${MAX_REDIRECTS} redirecciones: ${url}`);
  return null;
}

/**
 * Descarga `url` y devuelve el contenido con su mimetype, o null si la
 * respuesta no es válida, excede `maxBytes`, tarda más de `timeoutMs` o el
 * destino es interno. Nunca lanza.
 */
export async function fetchMedia(url: string, options: FetchMediaOptions = {}): Promise<FetchedMedia | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const reason = await rejectReason(url);
  if (reason) {
    log.warn(`descarga rechazada (${reason}): ${url}`);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const res = await fetchFollowing(url, { signal: controller.signal, headers: options.headers });
    if (!res) return null;
    if (!res.ok) {
      log.debug(`HTTP ${res.status} al descargar ${url}`);
      return null;
    }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType.startsWith('text/html')) {
      log.debug(`respuesta HTML en lugar de media: ${url}`);
      return null;
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      log.debug(`content-length ${declared} supera el máximo (${maxBytes}): ${url}`);
      return null;
    }
    const buffer = await readLimited(res, maxBytes, controller);
    if (!buffer) {
      log.debug(`descarga cortada por exceder ${maxBytes} bytes: ${url}`);
      return null;
    }
    if (buffer.length === 0) return null;
    return { buffer, mimetype: contentType || 'application/octet-stream' };
  } catch (error) {
    if (!controller.signal.aborted) {
      log.debug(`error al descargar ${url}:`, error instanceof Error ? error.message : error);
    } else {
      log.debug(`descarga abortada (timeout ${timeoutMs} ms o tamaño): ${url}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
