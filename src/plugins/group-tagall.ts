import type { PluginHandler, MessageContext } from '../types/message.js';
import { createLogger } from '../lib/logger.js';
import { mentionTag } from '../lib/utils.js';
import { findBotParticipant, getBotIds } from '../lib/participants.js';
import { downloadMessageMedia } from './group-tools.js';

const log = createLogger('grupos');

export const TAG_COLUMNS = 3;
/** WhatsApp acepta más, pero con cientos de menciones el cliente se arrastra. */
export const TAG_MAX_CHARS = 3500;

export interface TagChunk {
  text: string;
  mentions: string[];
}

/**
 * Reparte las menciones en filas de `columns` y trocea en varios mensajes si
 * el texto supera `maxChars`. El encabezado solo va en el primero.
 */
export function buildTagChunks(header: string, jids: readonly string[], columns = TAG_COLUMNS, maxChars = TAG_MAX_CHARS): TagChunk[] {
  const rows: string[] = [];
  for (let i = 0; i < jids.length; i += columns) {
    rows.push(jids.slice(i, i + columns).map(mentionTag).join('  '));
  }

  const chunks: TagChunk[] = [];
  let text = header;
  let mentions: string[] = [];
  let rowIndex = 0;
  for (const row of rows) {
    const candidate = `${text}\n${row}`;
    if (candidate.length > maxChars && mentions.length > 0) {
      chunks.push({ text, mentions });
      text = `📢 _(continúa)_\n${row}`;
      mentions = [];
    } else {
      text = candidate;
    }
    mentions.push(...jids.slice(rowIndex, rowIndex + columns));
    rowIndex += columns;
  }
  chunks.push({ text, mentions });
  return chunks;
}

/** Participantes del grupo sin el bot. */
function membersToTag(ctx: MessageContext): string[] {
  const { groupMetadata } = ctx;
  if (groupMetadata?.participants?.length) {
    const bot = findBotParticipant(groupMetadata, getBotIds(ctx));
    return groupMetadata.participants.filter((p) => p !== bot).map((p) => p.id);
  }
  return ctx.participants ?? [];
}

export const tagAllPlugin: PluginHandler = {
  command: ['tagall', 'todos', 'invocar', 'mencionartodos'],
  description: 'Mencionar a todos los miembros del grupo',
  category: 'group',
  help: ['tagall [mensaje] - Menciona a todos mostrando la lista'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn, groupMetadata } = ctx;
    const members = membersToTag(ctx);
    if (members.length === 0) {
      await m.reply('❌ No se pudo obtener la lista de participantes.');
      return;
    }

    const header =
      `📢 *MENCIÓN MASIVA*\n\n📝 ${text.trim() || '¡Atención a todos!'}\n\n` +
      `👥 *${groupMetadata?.subject || 'Grupo'}* · ${members.length} miembros\n`;

    for (const chunk of buildTagChunks(header, members)) {
      const sent = await conn.sendMessage(m.chat, { text: chunk.text, mentions: chunk.mentions }, { quoted: m.rawMessage });
      if (sent?.key) ctx.handler.trackMessage(m.chat, sent.key);
    }
  },
};

export const hideTagPlugin: PluginHandler = {
  command: ['hidetag', 'ht', 'n', 'notify', 'notificar', 'avisar'],
  description: 'Notifica a todos sin mostrar la lista de menciones',
  category: 'group',
  help: [
    'hidetag <mensaje> - Envía el mensaje notificando a todos',
    'hidetag (respondiendo a un mensaje) - Reenvía el texto, imagen o video citado notificando a todos',
  ],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn, usedPrefix } = ctx;
    const members = membersToTag(ctx);
    if (members.length === 0) {
      await m.reply('❌ No se pudo obtener la lista de participantes.');
      return;
    }

    const quoted = m.quoted;
    const caption = text.trim() || quoted?.text?.trim() || '';
    const image = quoted?.message?.imageMessage;
    const video = quoted?.message?.videoMessage;

    if (!caption && !image && !video) {
      await m.reply(
        `❌ Escribe un mensaje o responde a uno.\n\n📝 Uso:\n• ${usedPrefix}n Mensaje importante\n• ${usedPrefix}n (respondiendo a un texto, imagen o video)`,
      );
      return;
    }

    try {
      if (quoted && (image || video)) {
        const media = await downloadMessageMedia(conn, { key: quoted.key, message: quoted.message });
        const content = image
          ? { image: media, caption: caption || undefined, mentions: members }
          : { video: media, caption: caption || undefined, mentions: members, gifPlayback: Boolean(video?.gifPlayback), mimetype: video?.mimetype || 'video/mp4' };
        await conn.sendMessage(m.chat, content);
      } else {
        await conn.sendMessage(m.chat, { text: caption, mentions: members });
      }
      await m.react('📢');
    } catch (error) {
      log.warn(`hidetag en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No pude enviar la notificación (¿el adjunto ya caducó?).');
    }
  },
};
