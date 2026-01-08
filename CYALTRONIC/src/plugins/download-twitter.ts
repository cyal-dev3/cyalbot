/**
 * 🐦 Plugin de Descarga de Twitter/X
 * Comando: /twitter
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

const TWITTER_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/i;

/**
 * Obtiene información del video de Twitter/X
 */
async function getTwitterVideo(url: string): Promise<{
  success: boolean;
  video?: string;
  text?: string;
  author?: string;
  error?: string;
}> {
  try {
    // Usar API de twitsave.com
    const apiUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();

    // Extraer URL del video
    const videoMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i);
    if (!videoMatch) {
      // Buscar en formato alternativo
      const altMatch = html.match(/src="(https:\/\/[^"]+\.mp4[^"]*)"/i);
      if (!altMatch) {
        return { success: false, error: 'No se encontró el video' };
      }
      return { success: true, video: altMatch[1] };
    }

    // Extraer texto del tweet
    const textMatch = html.match(/<p class="[^"]*tweet-text[^"]*">([^<]+)<\/p>/i);

    // Extraer autor
    const authorMatch = html.match(/@([a-zA-Z0-9_]+)/);

    return {
      success: true,
      video: videoMatch[1],
      text: textMatch?.[1]?.trim(),
      author: authorMatch?.[1]
    };
  } catch (error) {
    console.error('Error en Twitter API:', error);
    return { success: false, error: 'Error al conectar con el servidor' };
  }
}

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

    const result = await getTwitterVideo(url);

    if (!result.success || !result.video) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el video'}`);
      return;
    }

    try {
      const response = await fetch(result.video);
      const buffer = Buffer.from(await response.arrayBuffer());

      let caption = `🐦 *Twitter/X Download*\n\n`;
      if (result.author) caption += `👤 @${result.author}\n`;
      if (result.text) caption += `💬 ${result.text.substring(0, 200)}${result.text.length > 200 ? '...' : ''}`;

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
