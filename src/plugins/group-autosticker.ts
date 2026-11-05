/**
 * Plugin Auto-Sticker
 * Convierte imágenes automáticamente a stickers
 * Comando: /autosticker on|off
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

/**
 * Comando /autosticker - Activar/desactivar auto-sticker
 */
export const autoStickerPlugin: PluginHandler = {
  command: ['autosticker', 'autostiker', 'as'],
  description: 'Activar/desactivar conversión automática de imágenes a stickers',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.autoSticker) {
        await m.reply('⚠️ El auto-sticker ya está activado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { autoSticker: true });
      await m.reply('✅ *Auto-Sticker activado*\n\n🎨 Las imágenes enviadas se convertirán automáticamente a stickers.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.autoSticker) {
        await m.reply('⚠️ El auto-sticker ya está desactivado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { autoSticker: false });
      await m.reply('✅ *Auto-Sticker desactivado*\n\n🎨 Las imágenes ya no se convertirán automáticamente.');
    } else {
      const status = chatSettings.autoSticker ? '🟢 Activado' : '🔴 Desactivado';
      await m.reply(`🎨 *AUTO-STICKER*\n\nEstado actual: ${status}\n\n📝 Uso:\n• /autosticker on - Activar\n• /autosticker off - Desactivar`);
    }
  }
};
