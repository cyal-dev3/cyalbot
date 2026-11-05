/**
 * Plugin de Descarga/Búsqueda en Pinterest
 * Comando: /pinterest
 * Usa múltiples APIs con fallback para máxima confiabilidad
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadPinterest, searchPinterest } from '../lib/downloaders.js';

const PINTEREST_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:pinterest\.com\/pin\/\d+|pin\.it\/[a-zA-Z0-9]+)/i;

/**
 * Comando /pinterest - Buscar imágenes o descargar pin específico
 */
export const pinterestPlugin: PluginHandler = {
  command: ['pinterest', 'pin'],
  description: 'Buscar imágenes en Pinterest o descargar un pin específico',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    const input = text.trim();

    if (!input) {
      await m.reply('📌 *PINTEREST*\n\n📝 Uso:\n• /pinterest <búsqueda> - Buscar imágenes\n• /pinterest <url> - Descargar pin específico\n\n📌 Ejemplos:\n/pinterest paisajes hermosos\n/pinterest https://pin.it/xxx');
      return;
    }

    await m.react('⏳');

    // Determinar si es URL o búsqueda
    const isUrl = PINTEREST_URL_REGEX.test(input);

    if (isUrl) {
      // Descargar pin específico
      const result = await downloadPinterest(input);

      if (!result.success || !result.medias || result.medias.length === 0) {
        await m.react('❌');
        await m.reply(`❌ ${result.error || 'No se pudo descargar el pin'}`);
        return;
      }

      try {
        for (let i = 0; i < result.medias.length && i < 5; i++) {
          const media = result.medias[i];
          const response = await fetch(media.url);
          const buffer = Buffer.from(await response.arrayBuffer());

          if (media.type === 'video') {
            await conn.sendMessage(m.chat, {
              video: buffer,
              caption: i === 0 ? `📌 *Pinterest Download*` : undefined,
              mimetype: 'video/mp4'
            }, { quoted: m.rawMessage });
          } else {
            await conn.sendMessage(m.chat, {
              image: buffer,
              caption: i === 0 ? `📌 *Pinterest Download*` : undefined
            }, { quoted: m.rawMessage });
          }
        }

        await m.react('✅');
      } catch (error) {
        console.error('Error enviando media Pinterest:', error);
        await m.react('❌');
        await m.reply('❌ Error al enviar el contenido. Intenta de nuevo.');
      }
    } else {
      // Búsqueda de imágenes
      const result = await searchPinterest(input);

      if (!result.success || !result.medias || result.medias.length === 0) {
        await m.react('❌');
        await m.reply(`❌ ${result.error || 'No se encontraron imágenes'}`);
        return;
      }

      try {
        // Enviar primera imagen con caption
        const firstResponse = await fetch(result.medias[0].url);
        const firstBuffer = Buffer.from(await firstResponse.arrayBuffer());

        await conn.sendMessage(m.chat, {
          image: firstBuffer,
          caption: `📌 *Pinterest*\n\n🔎 Búsqueda: ${input}\n📦 ${result.medias.length} imagen(es) encontrada(s)`
        }, { quoted: m.rawMessage });

        // Enviar el resto de imágenes
        for (let i = 1; i < result.medias.length; i++) {
          try {
            const response = await fetch(result.medias[i].url);
            const buffer = Buffer.from(await response.arrayBuffer());

            await conn.sendMessage(m.chat, { image: buffer });
          } catch {
            continue;
          }
        }

        await m.react('✅');
      } catch (error) {
        console.error('Error enviando imágenes Pinterest:', error);
        await m.react('❌');
        await m.reply('❌ Error al enviar las imágenes. Intenta de nuevo.');
      }
    }
  }
};
