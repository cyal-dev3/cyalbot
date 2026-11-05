/**
 * Plugin de Mención Masiva
 * Comando: /tagall
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

/**
 * Comando /tagall - Mencionar a todos los miembros del grupo
 */
export const tagAllPlugin: PluginHandler = {
  command: ['tagall', 'todos', 'invocar', 'mencionartodos'],
  description: 'Mencionar a todos los miembros del grupo',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn, participants, groupMetadata } = ctx;

    if (!participants || participants.length === 0) {
      await m.reply('❌ No se pudo obtener la lista de participantes.');
      return;
    }

    const groupName = groupMetadata?.subject || 'Grupo';
    const message = text.trim() || '📢 ¡Atención a todos!';

    // Construir mensaje con menciones
    let tagMessage = `📢 *MENCIÓN MASIVA*\n\n`;
    tagMessage += `📝 ${message}\n\n`;
    tagMessage += `👥 *Grupo:* ${groupName}\n`;
    tagMessage += `👤 *Miembros:* ${participants.length}\n\n`;

    // Agregar lista de usuarios
    for (const participant of participants) {
      const number = participant.split('@')[0];
      tagMessage += `• @${number}\n`;
    }

    await conn.sendMessage(m.chat, {
      text: tagMessage,
      mentions: participants
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /hidetag - Mención oculta (sin mostrar lista)
 */
export const hideTagPlugin: PluginHandler = {
  command: ['hidetag', 'ht', 'notificar'],
  description: 'Enviar mensaje mencionando a todos sin mostrar la lista',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn, participants } = ctx;

    if (!participants || participants.length === 0) {
      await m.reply('❌ No se pudo obtener la lista de participantes.');
      return;
    }

    const message = text.trim() || '📢 ¡Mensaje importante!';

    // Enviar mensaje con menciones ocultas
    await conn.sendMessage(m.chat, {
      text: message,
      mentions: participants
    }, { quoted: m.rawMessage });
  }
};
