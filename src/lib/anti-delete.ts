/**
 * Anti-delete: guarda los mensajes recientes de grupos y, si alguien borra uno
 * en un grupo con la opción activa, lo reenvía diciendo quién lo borró. Lo que
 * borra el propio bot o un admin no se reenvía.
 */

import { getContentType } from 'baileys';
import type { WASocket, proto, WAMessageUpdate, AnyMessageContent } from 'baileys';
import { LRUCache } from './lru-cache.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';
import { unwrapMessage, getText, getMediaSize } from './wa-message.js';
import { downloadMessageMedia } from './media.js';
import { getGroupMetadataCached } from './group-events.js';
import { findParticipant, isParticipantAdmin } from './participants.js';
import { mentionTag } from './utils.js';

const log = createLogger('antidelete');

const MAX_CACHED_MESSAGES = 5000;
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const cache = new LRUCache<string, proto.IWebMessageInfo>(MAX_CACHED_MESSAGES);
const keyOf = (chatId: string, msgId: string): string => `${chatId}|${msgId}`;

/** Contenidos sin nada que reenviar: ocuparían sitio en la caché desplazando mensajes reales. */
const NOT_RESENDABLE = new Set<keyof proto.IMessage>([
  'protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'keepInChatMessage',
]);

/** Guarda un mensaje de grupo para poder reenviarlo si lo borran. */
export function rememberMessage(msg: proto.IWebMessageInfo): void {
  const chatId = msg.key.remoteJid;
  if (!chatId || !msg.key.id || msg.key.fromMe) return;
  if (!chatId.endsWith('@g.us')) return;
  const content = unwrapMessage(msg);
  if (!content) return;
  const type = getContentType(content);
  if (!type || NOT_RESENDABLE.has(type)) return;
  cache.set(keyOf(chatId, msg.key.id), msg);
}

/** Solo para tests: true si el mensaje está en la caché de reenvío. */
export function isRemembered(chatId: string, msgId: string): boolean {
  return cache.has(keyOf(chatId, msgId));
}

/** Para que el handler no reenvíe lo que borra el propio bot (antilink, antibad, mute, clear). */
export function forgetMessage(chatId: string, msgId: string): void {
  cache.delete(keyOf(chatId, msgId));
}

function isRevoke(update: WAMessageUpdate): boolean {
  return update.update?.messageStubType === 1 || update.update?.message === null;
}

interface Header {
  text: string;
  mentions: string[];
}

/** Contenido a reenviar; null si no hay nada reenviable. */
async function resendContent(conn: WASocket, cached: proto.IWebMessageInfo, content: proto.IMessage): Promise<AnyMessageContent | null> {
  const text = getText(content);
  const media = () => downloadMessageMedia(conn, { key: cached.key, message: content });

  if (content.imageMessage) return { image: await media(), caption: text || undefined };
  if (content.videoMessage) {
    const isGif = Boolean(content.videoMessage.gifPlayback);
    return {
      video: await media(),
      caption: isGif ? undefined : text || undefined,
      mimetype: content.videoMessage.mimetype || 'video/mp4',
      gifPlayback: isGif,
    };
  }
  if (content.audioMessage) {
    return { audio: await media(), mimetype: content.audioMessage.mimetype || 'audio/mpeg', ptt: Boolean(content.audioMessage.ptt) };
  }
  if (content.stickerMessage) return { sticker: await media() };
  if (content.documentMessage) {
    return {
      document: await media(),
      mimetype: content.documentMessage.mimetype || 'application/octet-stream',
      fileName: content.documentMessage.fileName || 'documento',
      caption: text || undefined,
    };
  }
  if (text) return { text };
  if (content.contactMessage) {
    return {
      contacts: {
        displayName: content.contactMessage.displayName || 'Contacto',
        contacts: [{ vcard: content.contactMessage.vcard || '' }],
      },
    };
  }
  if (content.locationMessage) {
    return {
      location: {
        degreesLatitude: content.locationMessage.degreesLatitude || 0,
        degreesLongitude: content.locationMessage.degreesLongitude || 0,
      },
    };
  }
  return null;
}

/** Texto: encabezado y contenido en un solo mensaje; media y demás: encabezado aparte y luego el contenido. */
async function resend(conn: WASocket, chatId: string, cached: proto.IWebMessageInfo, header: Header): Promise<void> {
  const content = unwrapMessage(cached);
  if (!content) return;
  const payload = await resendContent(conn, cached, content);
  if (!payload) return;
  if ('text' in payload && typeof payload.text === 'string') {
    await conn.sendMessage(chatId, { text: `${header.text}\n\n${payload.text}`, mentions: header.mentions });
    return;
  }
  await conn.sendMessage(chatId, { text: header.text, mentions: header.mentions });
  await conn.sendMessage(chatId, payload);
}

/** Handler para el evento `messages.update` de Baileys. */
export async function handleMessageUpdates(conn: WASocket, updates: WAMessageUpdate[]): Promise<void> {
  for (const update of updates) {
    if (!isRevoke(update)) continue;
    const chatId = update.key?.remoteJid;
    const msgId = update.key?.id;
    if (!chatId || !msgId || !chatId.endsWith('@g.us')) continue;

    const db = getDatabase();
    if (!db.data.chats[chatId]?.antiDelete) continue;

    const cacheKey = keyOf(chatId, msgId);
    const cached = cache.get(cacheKey);
    if (!cached) continue;
    cache.delete(cacheKey);

    // update.update.key es la clave del mensaje de revocación: fromMe si lo borró el bot
    // y participant = quien borró (el autor u otro admin).
    const revokeKey = update.update?.key;
    if (revokeKey?.fromMe) continue;
    const revoker = revokeKey?.participant || cached.key.participant || undefined;
    if (revoker) {
      const metadata = await getGroupMetadataCached(conn, chatId);
      // Un admin borra con permiso: no se le desautoriza reenviando lo borrado.
      if (isParticipantAdmin(findParticipant(metadata, revoker))) continue;
    }

    const who = cached.pushName || 'usuario';
    const mediaSize = getMediaSize(unwrapMessage(cached));
    if (mediaSize > MAX_MEDIA_BYTES) {
      log.debug(`media de ${who} omitida (${(mediaSize / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }

    const header: Header = {
      text: `🗑️ ${mentionTag(revoker ?? chatId)} borró este mensaje`,
      mentions: revoker ? [revoker] : [],
    };

    try {
      await resend(conn, chatId, cached, header);
      log.debug(`mensaje borrado de ${who} reenviado`);
    } catch (error) {
      log.warn(`no se pudo reenviar mensaje de ${who}:`, error instanceof Error ? error.message : error);
    }
  }
}
