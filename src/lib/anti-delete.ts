/**
 * Anti-delete: guarda los mensajes recientes de grupos y, si alguien borra uno
 * en un grupo con la opción activa, lo reenvía.
 */

import { downloadMediaMessage, type WASocket, type proto, type WAMessageUpdate } from 'baileys';
import { LRUCache } from './lru-cache.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';

const log = createLogger('antidelete');

const MAX_CACHED_MESSAGES = 5000;
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const cache = new LRUCache<string, proto.IWebMessageInfo>(MAX_CACHED_MESSAGES);
const keyOf = (chatId: string, msgId: string): string => `${chatId}|${msgId}`;

/** Guarda un mensaje de grupo para poder reenviarlo si lo borran. */
export function rememberMessage(msg: proto.IWebMessageInfo): void {
  const chatId = msg.key.remoteJid;
  if (!chatId || !msg.key.id || !msg.message || msg.key.fromMe) return;
  if (!chatId.endsWith('@g.us')) return;
  cache.set(keyOf(chatId, msg.key.id), msg);
}

function isRevoke(update: WAMessageUpdate): boolean {
  return update.update?.messageStubType === 1 || update.update?.message === null;
}

async function download(conn: WASocket, msg: proto.IWebMessageInfo): Promise<Buffer> {
  return (await downloadMediaMessage(msg, 'buffer', {}, {
    logger: console as never,
    reuploadRequest: conn.updateMediaMessage,
  })) as Buffer;
}

async function resend(conn: WASocket, chatId: string, cached: proto.IWebMessageInfo): Promise<void> {
  const content = cached.message;
  if (!content) return;

  if (content.imageMessage) {
    await conn.sendMessage(chatId, { image: await download(conn, cached), caption: content.imageMessage.caption || undefined });
  } else if (content.videoMessage) {
    const isGif = Boolean(content.videoMessage.gifPlayback);
    await conn.sendMessage(chatId, {
      video: await download(conn, cached),
      caption: isGif ? undefined : content.videoMessage.caption || undefined,
      mimetype: content.videoMessage.mimetype || 'video/mp4',
      gifPlayback: isGif,
    });
  } else if (content.audioMessage) {
    await conn.sendMessage(chatId, {
      audio: await download(conn, cached),
      mimetype: content.audioMessage.mimetype || 'audio/mpeg',
      ptt: Boolean(content.audioMessage.ptt),
    });
  } else if (content.stickerMessage) {
    await conn.sendMessage(chatId, { sticker: await download(conn, cached) });
  } else if (content.documentMessage) {
    await conn.sendMessage(chatId, {
      document: await download(conn, cached),
      mimetype: content.documentMessage.mimetype || 'application/octet-stream',
      fileName: content.documentMessage.fileName || 'documento',
    });
  } else if (content.conversation || content.extendedTextMessage?.text) {
    await conn.sendMessage(chatId, { text: content.conversation || content.extendedTextMessage?.text || '' });
  } else if (content.contactMessage) {
    await conn.sendMessage(chatId, {
      contacts: {
        displayName: content.contactMessage.displayName || 'Contacto',
        contacts: [{ vcard: content.contactMessage.vcard || '' }],
      },
    });
  } else if (content.locationMessage) {
    await conn.sendMessage(chatId, {
      location: {
        degreesLatitude: content.locationMessage.degreesLatitude || 0,
        degreesLongitude: content.locationMessage.degreesLongitude || 0,
      },
    });
  }
}

/** Handler para el evento `messages.update` de Baileys. */
export async function handleMessageUpdates(conn: WASocket, updates: WAMessageUpdate[]): Promise<void> {
  for (const update of updates) {
    if (!isRevoke(update)) continue;
    const chatId = update.key?.remoteJid;
    const msgId = update.key?.id;
    if (!chatId || !msgId || !chatId.endsWith('@g.us')) continue;

    if (!getDatabase().getChatSettings(chatId).antiDelete) continue;

    const cacheKey = keyOf(chatId, msgId);
    const cached = cache.get(cacheKey);
    if (!cached?.message) continue;
    cache.delete(cacheKey);

    const content = cached.message;
    const mediaSize = Number(
      content.imageMessage?.fileLength ??
      content.videoMessage?.fileLength ??
      content.audioMessage?.fileLength ??
      content.documentMessage?.fileLength ??
      0,
    );
    const who = cached.pushName || 'usuario';
    if (mediaSize > MAX_MEDIA_BYTES) {
      log.debug(`media de ${who} omitida (${(mediaSize / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }

    try {
      await resend(conn, chatId, cached);
      log.debug(`mensaje borrado de ${who} reenviado`);
    } catch (error) {
      log.warn(`no se pudo reenviar mensaje de ${who}:`, error instanceof Error ? error.message : error);
    }
  }
}
