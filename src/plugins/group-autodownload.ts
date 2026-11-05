/**
 * Plugin Auto-Downloader
 * Detecta URLs de redes sociales y descarga automáticamente
 * Comando: /autodownload on|off
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

/**
 * Comando /autodownload - Activar/desactivar auto-descarga
 */
export const autoDownloadPlugin: PluginHandler = {
  command: ['autodownload', 'autodl', 'autodescarga'],
  description: 'Activar/desactivar descarga automática de URLs de redes sociales',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.autoDownload) {
        await m.reply('⚠️ El auto-download ya está activado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { autoDownload: true });
      await m.reply('✅ *Auto-Download activado*\n\n📥 Los enlaces de TikTok, Instagram, Facebook, Twitter, YouTube y Pinterest se descargarán automáticamente.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.autoDownload) {
        await m.reply('⚠️ El auto-download ya está desactivado en este grupo.');
        return;
      }
      db.updateChatSettings(m.chat, { autoDownload: false });
      await m.reply('✅ *Auto-Download desactivado*\n\n📥 Los enlaces ya no se descargarán automáticamente.');
    } else {
      const status = chatSettings.autoDownload ? '🟢 Activado' : '🔴 Desactivado';
      await m.reply(`📥 *AUTO-DOWNLOAD*\n\nEstado actual: ${status}\n\n📝 Uso:\n• /autodownload on - Activar\n• /autodownload off - Desactivar\n\n🔗 Plataformas:\nTikTok, Instagram, Facebook, Twitter/X, YouTube, Pinterest`);
    }
  }
};
