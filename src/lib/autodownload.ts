import type { WASocket } from 'baileys';
import type { SerializedMessage } from '../types/message.js';
import { getInfo, isDownloaderConfigured } from './downloader-client.js';
import { detectPlatform, downloadAuto, extractUrl, platformLabel } from './downloaders.js';
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
 * Decide si un enlace se baja solo en este chat: plataforma conocida, no
 * repetido en 10 min, sin otra descarga en curso en el chat y, para YouTube,
 * duración <= 180 s según /v1/info. Registra la URL como vista cuando acepta.
 */
export async function shouldAutoDownload(chat: string, url: string): Promise<boolean> {
  if (!isDownloaderConfigured()) return false;
  const platform = detectPlatform(url);
  if (platform === 'unknown') return false;
  if (busyChats.has(chat)) return false;

  const now = Date.now();
  if (recent.size > 500) pruneRecent(now);
  const key = dedupeKey(chat, url);
  const seenAt = recent.get(key);
  if (seenAt && now - seenAt < DEDUPE_TTL_MS) return false;
  recent.set(key, now);

  if (platform === 'youtube') {
    const info = await getInfo(url);
    if (!info.success || info.data.isPlaylist) return false;
    if (info.data.duration === null || info.data.duration > MAX_YOUTUBE_SECONDS) return false;
  }
  return true;
}

/** Reemplazo de MessageHandler.handleAutoDownload: extrae la URL del texto, descarga y envía hasta 5 archivos. */
export async function handleAutoDownload(conn: WASocket, m: SerializedMessage, text: string): Promise<void> {
  const url = extractUrl(text);
  if (!url) return;
  if (!(await shouldAutoDownload(m.chat, url))) return;

  busyChats.add(m.chat);
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
    busyChats.delete(m.chat);
  }
}
