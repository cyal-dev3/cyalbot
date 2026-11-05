/**
 * Plugin de Protección de Grupos
 * Comandos: /antilink, /antispam
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

/**
 * Comando /antilink - Activar/desactivar detección de enlaces
 */
export const antiLinkPlugin: PluginHandler = {
  command: ['antilink'],
  description: 'Activar/desactivar antilink en el grupo',
  category: 'group',
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.antiLink) {
        await m.reply('⚠️ El antilink ya está activado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { antiLink: true });
      await m.reply('✅ *Antilink activado*\n\n🔗 Los enlaces de grupos de WhatsApp serán eliminados automáticamente.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.antiLink) {
        await m.reply('⚠️ El antilink ya está desactivado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { antiLink: false });
      await m.reply('✅ *Antilink desactivado*\n\n🔗 Los enlaces de grupos ya no serán eliminados.');
    } else {
      const status = chatSettings.antiLink ? '🟢 Activado' : '🔴 Desactivado';
      await m.reply(`🛡️ *ANTILINK*\n\nEstado actual: ${status}\n\n📝 Uso:\n• /antilink on - Activar\n• /antilink off - Desactivar`);
    }
  }
};

/**
 * Comando /antispam - Activar/desactivar detección de spam
 */
export const antiSpamPlugin: PluginHandler = {
  command: ['antispam'],
  description: 'Activar/desactivar antispam en el grupo',
  category: 'group',
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.antiSpam) {
        await m.reply('⚠️ El antispam ya está activado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { antiSpam: true });
      await m.reply('✅ *Antispam activado*\n\n🚫 Los usuarios que envíen más de 5 mensajes en 10 segundos serán advertidos.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.antiSpam) {
        await m.reply('⚠️ El antispam ya está desactivado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { antiSpam: false });
      await m.reply('✅ *Antispam desactivado*\n\n🚫 El control de spam ha sido desactivado.');
    } else {
      const status = chatSettings.antiSpam ? '🟢 Activado' : '🔴 Desactivado';
      await m.reply(`🛡️ *ANTISPAM*\n\nEstado actual: ${status}\n\n📝 Uso:\n• /antispam on - Activar\n• /antispam off - Desactivar`);
    }
  }
};
