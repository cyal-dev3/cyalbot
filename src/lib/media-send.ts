import type { AnyMessageContent, proto, WASocket } from 'baileys';
import type { SerializedMessage } from '../types/message.js';
import { fetchMedia, type FetchedMedia, type FetchMediaOptions } from './fetch-media.js';
import type { MediaItem } from './downloaders.js';
import { createLogger } from './logger.js';

export { fetchMedia };
export type { FetchedMedia, FetchMediaOptions };

const log = createLogger('media');

const MB = 1024 * 1024;

/** Topes de WhatsApp por tipo de mensaje (video hasta 64 MB, audio e imagen 16 MB). */
export const LIMITS = {
  video: 64 * MB,
  audio: 16 * MB,
  image: 16 * MB,
} as const;

export type SendableType = keyof typeof LIMITS;

export interface SendMediasOptions {
  /** Texto que acompaña solo al primer archivo. */
  caption?: string;
  /** Máximo de archivos a enviar. */
  limit?: number;
  /** Nombre de archivo para audios (p. ej. "Canción.mp3"). */
  fileName?: string;
  /** Tiempo máximo para bajar cada archivo del servicio. */
  timeoutMs?: number;
  /** Para que el plugin registre los mensajes enviados (/clear). */
  trackMessage?: (key: proto.IMessageKey) => void;
}

export interface SendMediasResult {
  sent: number;
  total: number;
  /** Motivos de los archivos que no se enviaron, en orden. */
  errors: string[];
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

function extensionOf(name: string | undefined): string {
  return (name ?? '').split('?')[0].split('.').pop()?.toLowerCase() ?? '';
}

/** Mimetype por el tipo real del archivo; el audio depende de la extensión que produjo el servicio. */
export function mimetypeFor(type: SendableType, filename?: string, fetchedMime?: string): string {
  if (type === 'audio') return AUDIO_MIME[extensionOf(filename)] ?? (fetchedMime?.startsWith('audio/') ? fetchedMime : 'audio/mpeg');
  if (type === 'video') return 'video/mp4';
  return fetchedMime?.startsWith('image/') ? fetchedMime : 'image/jpeg';
}

export function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

function buildContent(type: SendableType, media: FetchedMedia, item: MediaItem, caption: string | undefined, fileName: string | undefined): AnyMessageContent {
  const mimetype = mimetypeFor(type, item.filename, media.mimetype);
  if (type === 'video') return { video: media.buffer, mimetype, caption };
  if (type === 'audio') return { audio: media.buffer, mimetype, ptt: false, fileName: fileName ?? item.filename ?? undefined };
  return { image: media.buffer, mimetype, caption };
}

/**
 * Descarga y envía cada media al chat del mensaje, citándolo. Comprueba el
 * tamaño declarado antes de bajar, pone el caption solo en el primero y
 * devuelve cuántos envió con el motivo de los que no.
 */
export async function sendMedias(
  conn: WASocket,
  m: SerializedMessage,
  medias: MediaItem[],
  options: SendMediasOptions = {},
): Promise<SendMediasResult> {
  const limit = options.limit ?? medias.length;
  const selected = medias.slice(0, Math.max(0, limit));
  const result: SendMediasResult = { sent: 0, total: selected.length, errors: [] };

  for (const [index, item] of selected.entries()) {
    const type: SendableType = item.type in LIMITS ? item.type : 'video';
    const maxBytes = LIMITS[type];
    if (item.size > maxBytes) {
      result.errors.push(`el archivo ${index + 1} pesa ${formatMb(item.size)}, el máximo es ${formatMb(maxBytes)}`);
      continue;
    }

    const fetched = await fetchMedia(item.url, { maxBytes, timeoutMs: options.timeoutMs ?? 120_000 });
    if (!fetched) {
      result.errors.push(`no se pudo bajar el archivo ${index + 1} (demasiado grande o el servicio no respondió)`);
      continue;
    }

    const caption = index === 0 ? options.caption : undefined;
    try {
      const sent = await conn.sendMessage(m.chat, buildContent(type, fetched, item, caption, options.fileName), { quoted: m.rawMessage });
      if (sent?.key) options.trackMessage?.(sent.key);
      result.sent += 1;
    } catch (error) {
      log.warn(`fallo al enviar ${type} ${index + 1}/${selected.length}:`, error instanceof Error ? error.message : error);
      result.errors.push(`WhatsApp rechazó el archivo ${index + 1}`);
    }
  }

  // Un audio sin caption deja la descripción sin sitio: se manda como texto aparte.
  if (result.sent > 0 && options.caption && selected[0]?.type === 'audio') {
    const note = await conn.sendMessage(m.chat, { text: options.caption }, { quoted: m.rawMessage }).catch(() => undefined);
    if (note?.key) options.trackMessage?.(note.key);
  }
  return result;
}
