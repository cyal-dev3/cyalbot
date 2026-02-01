/**
 * 📸 Plugin de Descarga de Instagram
 * Comando: /ig
 * Usa múltiples APIs con fallback para máxima confiabilidad
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadInstagram } from '../lib/downloaders.js';

const IG_REGEX = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories)\/[a-zA-Z0-9_-]+/i;

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

    const result = await downloadInstagram(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el contenido. El post puede ser privado.'}`);
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
