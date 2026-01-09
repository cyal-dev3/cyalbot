/**
 * 📸 Plugin de Descarga de Instagram
 * Comando: /ig
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

const IG_REGEX = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories)\/[a-zA-Z0-9_-]+/i;

/**
 * Obtiene información del post de Instagram
 */
async function getInstagramMedia(url: string): Promise<{
  success: boolean;
  medias?: Array<{ url: string; type: 'video' | 'image' }>;
  error?: string;
}> {
  try {
    // Usar API de igdownloader
    const apiUrl = `https://v3.igdownloader.app/api/ajaxSearch`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: `recaptchaToken=&q=${encodeURIComponent(url)}&t=media&lang=en`
    });

    const data = await response.json() as {
      status: string;
      data?: string;
    };

    if (data.status !== 'ok' || !data.data) {
      return { success: false, error: 'No se pudo obtener el contenido' };
    }

    // Parsear el HTML para extraer URLs
    const medias: Array<{ url: string; type: 'video' | 'image' }> = [];

    // Buscar videos
    const videoMatches = data.data.matchAll(/href="([^"]+)"\s+class="[^"]*abutton[^"]*"[^>]*>.*?Download Video/gi);
    for (const match of videoMatches) {
      if (match[1]) {
        medias.push({ url: match[1], type: 'video' });
      }
    }

    // Buscar imágenes
    const imageMatches = data.data.matchAll(/href="([^"]+)"\s+class="[^"]*abutton[^"]*"[^>]*>.*?Download Photo/gi);
    for (const match of imageMatches) {
      if (match[1]) {
        medias.push({ url: match[1], type: 'image' });
      }
    }

    // Fallback: buscar cualquier URL de descarga
    if (medias.length === 0) {
      const allUrls = data.data.matchAll(/href="(https:\/\/[^"]+(?:\.mp4|\.jpg|\.jpeg|\.png)[^"]*)"/gi);
      for (const match of allUrls) {
        if (match[1]) {
          const isVideo = match[1].includes('.mp4');
          medias.push({ url: match[1], type: isVideo ? 'video' : 'image' });
        }
      }
    }

    if (medias.length === 0) {
      return { success: false, error: 'No se encontraron medios para descargar' };
    }

    return { success: true, medias };
  } catch (error) {
    console.error('Error en Instagram API:', error);
    return { success: false, error: 'Error al conectar con el servidor' };
  }
}

/**
 * Comando /ig - Descargar contenido de Instagram
 */
export const instagramPlugin: PluginHandler = {
  command: ['ig', 'instagram', 'igdl'],
  description: 'Descargar contenido de Instagram (posts, reels, stories)',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener URL del texto o del mensaje citado
    let url = text.trim();

    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(IG_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('📸 *DESCARGAR INSTAGRAM*\n\n📝 Uso: /ig <url>\n\n📌 Ejemplo:\n/ig https://www.instagram.com/p/xxx\n/ig https://www.instagram.com/reel/xxx');
      return;
    }

    // Validar URL
    if (!IG_REGEX.test(url)) {
      await m.reply('❌ URL de Instagram no válida.\n\n📌 Formatos soportados:\n• Posts: instagram.com/p/xxx\n• Reels: instagram.com/reel/xxx\n• Stories: instagram.com/stories/xxx');
      return;
    }

    await m.react('⏳');

    const result = await getInstagramMedia(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el contenido'}`);
      return;
    }

    try {
      // Enviar cada media
      for (let i = 0; i < result.medias.length && i < 10; i++) {
        const media = result.medias[i];

        const response = await fetch(media.url);
        const buffer = Buffer.from(await response.arrayBuffer());

        if (media.type === 'video') {
          await conn.sendMessage(m.chat, {
            video: buffer,
            caption: i === 0 ? `📸 *Instagram Download*\n\n📦 ${result.medias.length} archivo(s)` : undefined,
            mimetype: 'video/mp4'
          }, { quoted: m.rawMessage });
        } else {
          await conn.sendMessage(m.chat, {
            image: buffer,
            caption: i === 0 ? `📸 *Instagram Download*\n\n📦 ${result.medias.length} archivo(s)` : undefined
          }, { quoted: m.rawMessage });
        }
      }

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando media Instagram:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el contenido. Intenta de nuevo.');
    }
  }
};
