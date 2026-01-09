/**
 * 📘 Plugin de Descarga de Facebook
 * Comando: /fb
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

const FB_REGEX = /(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i;

/**
 * Obtiene información del video de Facebook
 */
async function getFacebookVideo(url: string): Promise<{
  success: boolean;
  video?: string;
  videoHD?: string;
  title?: string;
  error?: string;
}> {
  try {
    // Usar API de fdown.net
    const apiUrl = 'https://fdown.net/download.php';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: `URLz=${encodeURIComponent(url)}`
    });

    const html = await response.text();

    // Extraer URLs del HTML
    const hdMatch = html.match(/href="(https:\/\/[^"]+)" id="hdlink"/);
    const sdMatch = html.match(/href="(https:\/\/[^"]+)" id="sdlink"/);

    if (!hdMatch && !sdMatch) {
      // Intentar método alternativo
      const altMatch = html.match(/href="(https:\/\/video[^"]+\.mp4[^"]*)"/);
      if (altMatch) {
        return { success: true, video: altMatch[1] };
      }
      return { success: false, error: 'No se encontró el video' };
    }

    return {
      success: true,
      videoHD: hdMatch?.[1],
      video: sdMatch?.[1] || hdMatch?.[1]
    };
  } catch (error) {
    console.error('Error en Facebook API:', error);
    return { success: false, error: 'Error al conectar con el servidor' };
  }
}

/**
 * Comando /fb - Descargar video de Facebook
 */
export const facebookPlugin: PluginHandler = {
  command: ['fb', 'facebook', 'fbdl'],
  description: 'Descargar video de Facebook',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener URL del texto o del mensaje citado
    let url = text.trim();

    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(FB_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('📘 *DESCARGAR FACEBOOK*\n\n📝 Uso: /fb <url>\n\n📌 Ejemplo:\n/fb https://www.facebook.com/watch?v=xxx\n/fb https://fb.watch/xxx');
      return;
    }

    // Validar URL
    if (!FB_REGEX.test(url)) {
      await m.reply('❌ URL de Facebook no válida.\n\n📌 Formatos soportados:\n• facebook.com/watch?v=xxx\n• fb.watch/xxx\n• facebook.com/xxx/videos/xxx');
      return;
    }

    await m.react('⏳');

    const result = await getFacebookVideo(url);

    if (!result.success || !result.video) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el video'}`);
      return;
    }

    try {
      // Intentar HD primero, si no SD
      const videoUrl = result.videoHD || result.video;

      const response = await fetch(videoUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      const caption = `📘 *Facebook Download*\n\n📺 Calidad: ${result.videoHD ? 'HD' : 'SD'}`;

      await conn.sendMessage(m.chat, {
        video: buffer,
        caption,
        mimetype: 'video/mp4'
      }, { quoted: m.rawMessage });

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando video Facebook:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el video. Intenta de nuevo.');
    }
  }
};
