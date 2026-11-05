import { downloadMediaMessage, type proto, type WASocket } from 'baileys';
import pino from 'pino';
import type { MessageContext, SerializedMessage } from '../types/message.js';
import { createLogger } from './logger.js';
import { StickerTooLargeError } from './sticker.js';

const log = createLogger('media');
const silentLogger = pino({ level: 'silent' });

export type MessageMediaKind = 'image' | 'video' | 'sticker' | 'audio';

export interface MediaInMessage {
  kind: MessageMediaKind;
  mimetype: string;
  /** Solo stickers: lo que WhatsApp declara en el mensaje. */
  isAnimated: boolean;
  /** Bytes declarados por WhatsApp (0 si no vienen). */
  declaredSize: number;
}

export interface FetchedMessageMedia extends MediaInMessage {
  buffer: Buffer;
  source: 'quoted' | 'own';
}

/** Qué media trae un mensaje. Un documento cuenta por su mimetype (video/imagen/audio). */
export function mediaInMessage(message: proto.IMessage | null | undefined): MediaInMessage | null {
  if (!message) return null;
  if (message.imageMessage) {
    return { kind: 'image', mimetype: message.imageMessage.mimetype || 'image/jpeg', isAnimated: false, declaredSize: Number(message.imageMessage.fileLength ?? 0) };
  }
  if (message.videoMessage) {
    return { kind: 'video', mimetype: message.videoMessage.mimetype || 'video/mp4', isAnimated: true, declaredSize: Number(message.videoMessage.fileLength ?? 0) };
  }
  if (message.stickerMessage) {
    return { kind: 'sticker', mimetype: message.stickerMessage.mimetype || 'image/webp', isAnimated: message.stickerMessage.isAnimated === true, declaredSize: Number(message.stickerMessage.fileLength ?? 0) };
  }
  if (message.audioMessage) {
    return { kind: 'audio', mimetype: message.audioMessage.mimetype || 'audio/ogg', isAnimated: false, declaredSize: Number(message.audioMessage.fileLength ?? 0) };
  }
  const doc = message.documentMessage;
  if (doc?.mimetype) {
    const base = doc.mimetype.split('/')[0];
    const kind = base === 'video' ? 'video' : base === 'image' ? 'image' : base === 'audio' ? 'audio' : null;
    if (kind) return { kind, mimetype: doc.mimetype, isAnimated: kind === 'video', declaredSize: Number(doc.fileLength ?? 0) };
  }
  return null;
}

/** Texto del mensaje citado incluyendo el caption de video, que el handler aún no incorpora. */
export function getQuotedText(m: SerializedMessage): string {
  return m.quoted?.text || m.quoted?.message?.videoMessage?.caption || m.quoted?.message?.documentMessage?.caption || '';
}

/** Descarga el adjunto de un mensaje (propio o citado) como Buffer, resubiéndolo si WhatsApp lo caducó. */
export async function downloadMessageMedia(conn: WASocket, msg: { key: proto.IMessageKey; message: proto.IMessage }): Promise<Buffer> {
  return (await downloadMediaMessage(msg as proto.IWebMessageInfo, 'buffer', {}, {
    logger: silentLogger,
    reuploadRequest: conn.updateMediaMessage,
  })) as Buffer;
}

export interface QuotedOrOwnOptions {
  /** Tamaño máximo declarado; se rechaza antes de descargar. */
  maxBytes?: number;
}

/**
 * Media del mensaje citado o, si no hay, del propio mensaje (imagen con el
 * comando en el caption), filtrada por tipo. Lanza MediaTooLargeError si el
 * adjunto declara más de `maxBytes`.
 */
export async function getQuotedOrOwnMedia(
  ctx: Pick<MessageContext, 'conn' | 'm'>,
  kinds: MessageMediaKind[],
  options: QuotedOrOwnOptions = {},
): Promise<FetchedMessageMedia | null> {
  const { conn, m } = ctx;
  const candidates: { source: 'quoted' | 'own'; key: proto.IMessageKey; message: proto.IMessage | null | undefined }[] = [];
  if (m.quoted?.message) candidates.push({ source: 'quoted', key: m.quoted.key, message: m.quoted.message });
  candidates.push({ source: 'own', key: m.key, message: m.message ?? m.rawMessage?.message });

  for (const candidate of candidates) {
    const info = mediaInMessage(candidate.message);
    if (!info || !kinds.includes(info.kind) || !candidate.message) continue;
    if (options.maxBytes && info.declaredSize > options.maxBytes) {
      throw new MediaTooLargeError(info.declaredSize, options.maxBytes);
    }
    const buffer = await downloadMessageMedia(conn, { key: candidate.key, message: candidate.message });
    if (options.maxBytes && buffer.length > options.maxBytes) throw new MediaTooLargeError(buffer.length, options.maxBytes);
    return { ...info, buffer, source: candidate.source };
  }
  return null;
}

export class MediaTooLargeError extends Error {
  constructor(readonly size: number, readonly max: number) {
    super(`El archivo pesa ${(size / (1024 * 1024)).toFixed(1)} MB y el máximo es ${Math.round(max / (1024 * 1024))} MB`);
    this.name = 'MediaTooLargeError';
  }
}

/** Responde con un texto útil según el error de ffmpeg/descarga y lo deja en el log. */
export async function replyMediaError(m: SerializedMessage, error: unknown, fallback: string): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log.warn(fallback, message);
  let text = fallback;
  if (error instanceof MediaTooLargeError) text = `⚠️ ${error.message}.`;
  else if (error instanceof StickerTooLargeError) text = `⚠️ ${error.message}`;
  else if (/no está instalado/i.test(message)) text = '❌ El servidor no tiene ffmpeg instalado; avisa al dueño del bot.';
  else if (/superó \d+ s/i.test(message)) text = '⏱️ La conversión tardó demasiado. Prueba con un archivo más corto.';
  else if (/media (?:message )?not found|empty media key|no se pudo descargar|reupload/i.test(message)) text = '❌ No pude descargar el archivo del mensaje. Reenvíalo e inténtalo otra vez.';
  await m.reply(text);
}
