/**
 * Plugin de Descarga de Facebook
 * Comando: /fb
 * Usa múltiples APIs con fallback para máxima confiabilidad
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadFacebook } from '../lib/downloaders.js';

const FB_REGEX = /(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/[^\s]+/i;

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

    const result = await downloadFacebook(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el video'}`);
      return;
    }

    try {
      // Usar el video de mejor calidad
      const media = result.medias[0];
      const response = await fetch(media.url);
      const buffer = Buffer.from(await response.arrayBuffer());

      const caption = `📘 *Facebook Download*\n\n📺 Calidad: ${media.quality || 'Estándar'}`;

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
