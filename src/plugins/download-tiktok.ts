/**
 * Plugin de Descarga de TikTok
 * Comando: /tiktok
 * Usa múltiples APIs con fallback para máxima confiabilidad
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadTikTok } from '../lib/downloaders.js';

const TIKTOK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)\/[^\s]+/i;

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

    const result = await downloadTikTok(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el video'}`);
      return;
    }

    try {
      const caption = `📱 *TikTok Download*\n\n` +
        `👤 Autor: ${result.author || 'Desconocido'}\n` +
        `📝 ${result.title || 'Sin título'}`;

      // Enviar cada media
      for (let i = 0; i < result.medias.length && i < 10; i++) {
        const media = result.medias[i];
        const response = await fetch(media.url);
        const buffer = Buffer.from(await response.arrayBuffer());

        if (media.type === 'video') {
          await conn.sendMessage(m.chat, {
            video: buffer,
            caption: i === 0 ? caption : undefined,
            mimetype: 'video/mp4'
          }, { quoted: m.rawMessage });
        } else {
          await conn.sendMessage(m.chat, {
            image: buffer,
            caption: i === 0 ? caption : undefined
          }, { quoted: m.rawMessage });
        }
      }

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando video TikTok:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el video. Intenta de nuevo.');
    }
  }
};
