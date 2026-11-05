import type { WASocket } from 'baileys';
import type { SerializedMessage } from '../types/message.js';
import { getInfo, isDownloaderConfigured } from './downloader-client.js';
import { detectPlatform, downloadAuto, extractUrl, platformLabel, type Platform } from './downloaders.js';
import { createLogger } from './logger.js';
import { sendMedias } from './media-send.js';

const log = createLogger('downloads');

/** Mismo enlace en el mismo chat: se ignora durante este tiempo. */
export const DEDUPE_TTL_MS = 10 * 60 * 1000;
/** YouTube solo se baja solo si el video es corto. */
export const MAX_YOUTUBE_SECONDS = 180;
export const MAX_AUTO_MEDIAS = 5;

const recent = new Map<string, number>();
const busyChats = new Set<string>();

function dedupeKey(chat: string, url: string): string {
  return `${chat}|${url.toLowerCase()}`;
}

function pruneRecent(now: number): void {
  for (const [key, seenAt] of recent) {
    if (now - seenAt > DEDUPE_TTL_MS) recent.delete(key);
  }
}

/**
 * Comprobaciones sincrónicas: servicio configurado, plataforma conocida, sin
 * otra descarga en curso en el chat y no repetido en 10 min. Si acepta,
 * registra la URL como vista y marca el chat como ocupado en el mismo tick,
 * para que dos enlaces seguidos del mismo chat no pasen ambos.
 */
function claimAutoDownload(chat: string, url: string): Platform | null {
  if (!isDownloaderConfigured()) return null;
  const platform = detectPlatform(url);
  if (platform === 'unknown') return null;
  if (busyChats.has(chat)) return null;

  const now = Date.now();
  if (recent.size > 500) pruneRecent(now);
  const key = dedupeKey(chat, url);
  const seenAt = recent.get(key);
  if (seenAt && now - seenAt < DEDUPE_TTL_MS) return null;
  recent.set(key, now);
  busyChats.add(chat);
  return platform;
}

/** YouTube solo se baja solo si es un video (no lista) de hasta 3 min según /v1/info. */
async function isShortYoutubeVideo(url: string): Promise<boolean> {
  const info = await getInfo(url);
  if (!info.success || info.data.isPlaylist) return false;
  return info.data.duration !== null && info.data.duration <= MAX_YOUTUBE_SECONDS;
}

/**
 * Decide si un enlace se baja solo en este chat. Si devuelve true el chat
 * queda reservado (una descarga a la vez) y el llamador debe liberarlo con
 * releaseAutoDownload cuando termine; la reserva se hace antes del getInfo de
 * YouTube para que dos enlaces seguidos no pasen ambos.
 */
export async function shouldAutoDownload(chat: string, url: string): Promise<boolean> {
  const platform = claimAutoDownload(chat, url);
  if (!platform) return false;
  if (platform === 'youtube' && !(await isShortYoutubeVideo(url))) {
    busyChats.delete(chat);
    return false;
  }
  return true;
}

export function releaseAutoDownload(chat: string): void {
  busyChats.delete(chat);
}

/** Reemplazo de MessageHandler.handleAutoDownload: extrae la URL del texto, descarga y envía hasta 5 archivos. */
export async function handleAutoDownload(conn: WASocket, m: SerializedMessage, text: string): Promise<void> {
  const url = extractUrl(text);
  if (!url) return;
  if (!(await shouldAutoDownload(m.chat, url))) return;

  try {
    const result = await downloadAuto(url);
    if (!result.success || !result.medias?.length) {
      log.debug(`autodownload ${platformLabel(result.platform)} falló: ${result.code ?? ''} ${result.error ?? ''}`);
      return;
    }
    let caption = `📥 ${platformLabel(result.platform)}`;
    if (result.author) caption += ` | ${result.author}`;
    if (result.title) caption += `\n${result.title.slice(0, 100)}`;
    const sent = await sendMedias(conn, m, result.medias, { caption, limit: MAX_AUTO_MEDIAS });
    log.debug(`autodownload ${platformLabel(result.platform)}: ${sent.sent}/${sent.total} enviados`, sent.errors.join('; '));
  } catch (error) {
    log.error('autodownload:', error instanceof Error ? error.message : error);
  } finally {
    releaseAutoDownload(m.chat);
  }
}
