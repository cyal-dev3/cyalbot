/**
 * 📱 Plugin de Descarga de TikTok
 * Comando: /tiktok
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

const TIKTOK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)\/[^\s]+/i;

/**
 * Obtiene información del video de TikTok usando tikwm.com API
 */
async function getTikTokVideo(url: string): Promise<{
  success: boolean;
  video?: string;
  music?: string;
  title?: string;
  author?: string;
  error?: string;
}> {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const data = await response.json() as {
      code: number;
      data?: {
        play?: string;
        hdplay?: string;
        music?: string;
        title?: string;
        author?: { nickname?: string };
      };
    };

    if (data.code !== 0 || !data.data) {
      return { success: false, error: 'No se pudo obtener el video' };
    }

    return {
      success: true,
      video: data.data.hdplay || data.data.play,
      music: data.data.music,
      title: data.data.title,
      author: data.data.author?.nickname
    };
  } catch (error) {
    console.error('Error en TikTok API:', error);
    return { success: false, error: 'Error al conectar con el servidor' };
  }
}

/**
 * Comando /tiktok - Descargar video de TikTok sin marca de agua
 */
export const tiktokPlugin: PluginHandler = {
  command: ['tiktok', 'tt', 'ttdl'],
  description: 'Descargar video de TikTok sin marca de agua',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener URL del texto o del mensaje citado
    let url = text.trim();

    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(TIKTOK_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('📱 *DESCARGAR TIKTOK*\n\n📝 Uso: /tiktok <url>\n\n📌 Ejemplo:\n/tiktok https://vm.tiktok.com/xxx');
      return;
    }

    // Validar URL
    if (!TIKTOK_REGEX.test(url)) {
      await m.reply('❌ URL de TikTok no válida.\n\n📌 Ejemplo: https://vm.tiktok.com/xxx');
      return;
    }

    await m.react('⏳');

    const result = await getTikTokVideo(url);

    if (!result.success || !result.video) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el video'}`);
      return;
    }

    try {
      // Descargar y enviar el video
      const videoResponse = await fetch(result.video);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

      const caption = `📱 *TikTok Download*\n\n` +
        `👤 Autor: ${result.author || 'Desconocido'}\n` +
        `📝 ${result.title || 'Sin título'}`;

      await conn.sendMessage(m.chat, {
        video: videoBuffer,
        caption,
        mimetype: 'video/mp4'
      }, { quoted: m.rawMessage });

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando video TikTok:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el video. Intenta de nuevo.');
    }
  }
};
