/**
 * Plugin Anti-Delete
 * Reenvía mensajes eliminados al mismo grupo
 * Comando: /antidelete on|off
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

/**
 * Comando /antidelete - Activar/desactivar anti-delete
 */
export const antiDeletePlugin: PluginHandler = {
  command: ['antidelete', 'antieliminar'],
  description: 'Activar/desactivar reenvío de mensajes eliminados',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.antiDelete) {
        await m.reply('⚠️ El anti-delete ya está activado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { antiDelete: true });
      await m.reply('✅ *Anti-Delete activado*\n\n🗑️ Los mensajes eliminados serán reenviados al grupo.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.antiDelete) {
        await m.reply('⚠️ El anti-delete ya está desactivado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { antiDelete: false });
      await m.reply('✅ *Anti-Delete desactivado*\n\n🗑️ Los mensajes eliminados ya no serán reenviados.');
    } else {
      const status = chatSettings.antiDelete ? '🟢 Activado' : '🔴 Desactivado';
      await m.reply(`🗑️ *ANTI-DELETE*\n\nEstado actual: ${status}\n\n📝 Uso:\n• /antidelete on - Activar\n• /antidelete off - Desactivar`);
    }
  }
};
