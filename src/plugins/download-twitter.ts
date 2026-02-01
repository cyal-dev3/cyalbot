/**
 * 🐦 Plugin de Descarga de Twitter/X
 * Comando: /twitter
 * Usa múltiples APIs con fallback para máxima confiabilidad
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadTwitter } from '../lib/downloaders.js';

const TWITTER_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/i;

/**
 * Comando /twitter - Descargar video de Twitter/X
 */
export const twitterPlugin: PluginHandler = {
  command: ['twitter', 'tw', 'twdl', 'x'],
  description: 'Descargar video de Twitter/X',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener URL del texto o del mensaje citado
    let url = text.trim();

    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(TWITTER_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('🐦 *DESCARGAR TWITTER/X*\n\n📝 Uso: /twitter <url>\n\n📌 Ejemplo:\n/twitter https://twitter.com/user/status/123\n/twitter https://x.com/user/status/123');
      return;
    }

    // Validar URL
    if (!TWITTER_REGEX.test(url)) {
      await m.reply('❌ URL de Twitter/X no válida.\n\n📌 Formato: twitter.com/user/status/123');
      return;
    }

    await m.react('⏳');

    const result = await downloadTwitter(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el video'}`);
      return;
    }

    try {
      const media = result.medias[0];
      const response = await fetch(media.url);
      const buffer = Buffer.from(await response.arrayBuffer());

      let caption = `🐦 *Twitter/X Download*\n\n`;
      if (result.author) caption += `👤 @${result.author}\n`;
      if (result.description) {
        const desc = result.description.substring(0, 200);
        caption += `💬 ${desc}${result.description.length > 200 ? '...' : ''}`;
      }

      await conn.sendMessage(m.chat, {
        video: buffer,
        caption,
        mimetype: 'video/mp4'
      }, { quoted: m.rawMessage });

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando video Twitter:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el video. Intenta de nuevo.');
    }
  }
};
