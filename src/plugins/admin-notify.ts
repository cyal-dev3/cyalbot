/**
 * Plugin de Notificación Forzada
 * Envía un mensaje que notifica a todos los miembros del grupo
 * incluso si tienen el grupo silenciado
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

export const notifyPlugin: PluginHandler = {
  command: /^(n|notify|notificar|avisar)$/i,
  tags: ['admin', 'grupo'],
  help: [
    'n <mensaje> - Envía una notificación a todos',
    'n (respondiendo mensaje) - Notifica con el mensaje citado'
  ],
  group: true,
  admin: true,

  handler: async (ctx: MessageContext) => {
    const { conn, m, text, participants } = ctx;

    // Obtener el mensaje a notificar
    let notifyText = text;

    // Si no hay texto, verificar si está respondiendo a un mensaje
    if (!notifyText && m.quoted) {
      notifyText = m.quoted.text;
    }

    if (!notifyText) {
      return m.reply(
        '❌ *Debes proporcionar un mensaje o responder a uno*\n\n' +
        '📝 *Uso:*\n' +
        '• .n Mensaje importante aquí\n' +
        '• .n (respondiendo a un mensaje)'
      );
    }

    // Obtener todos los participantes del grupo excepto el bot
    const botJid = conn.user?.id;
    const mentions = participants?.filter(p => {
      // Excluir al bot
      if (botJid) {
        const botNumber = botJid.split(':')[0].split('@')[0];
        const pNumber = p.split('@')[0];
        if (pNumber === botNumber || p === botJid) return false;
      }
      return true;
    }) || [];

    if (mentions.length === 0) {
      return m.reply('❌ No hay participantes para notificar');
    }

    // Formatear el mensaje de notificación
    const notifyMessage = `📢 *NOTIFICACIÓN*\n\n${notifyText}`;

    // Enviar mensaje con menciones invisibles (notifica a todos)
    await conn.sendMessage(m.chat, {
      text: notifyMessage,
      mentions: mentions
    });

    // Reaccionar al mensaje original para confirmar
    await m.react('📢');
  }
};

export default notifyPlugin;
