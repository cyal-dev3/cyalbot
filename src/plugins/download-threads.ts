/**
 * Plugin de Descarga de Threads
 * Comando: /threads
 * Descarga videos e imágenes de Threads (Meta)
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadThreads } from '../lib/downloaders.js';

const THREADS_REGEX = /(?:https?:\/\/)?(?:www\.)?threads\.net\/(?:@[a-zA-Z0-9_.]+\/)?post\/[a-zA-Z0-9_-]+/i;

/**
 * Comando /threads - Descargar contenido de Threads
 */
export const threadsPlugin: PluginHandler = {
  command: ['threads', 'th', 'thdl'],
  description: 'Descargar contenido de Threads (videos, imágenes)',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener URL del texto o del mensaje citado
    let url = text.trim();

    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(THREADS_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('🧵 *DESCARGAR THREADS*\n\n📝 Uso: /threads <url>\n\n📌 Ejemplo:\n/threads https://www.threads.net/@user/post/xxx');
      return;
    }

    // Validar URL
    if (!THREADS_REGEX.test(url)) {
      await m.reply('❌ URL de Threads no válida.\n\n📌 Formato: threads.net/@user/post/xxx');
      return;
    }

    await m.react('⏳');

    const result = await downloadThreads(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el contenido de Threads'}`);
      return;
    }

    try {
      let caption = `🧵 *Threads Download*\n\n`;
      if (result.author) caption += `👤 @${result.author}\n`;
      if (result.description) {
        const desc = result.description.substring(0, 200);
        caption += `💬 ${desc}${result.description.length > 200 ? '...' : ''}`;
      }

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
      console.error('Error enviando media Threads:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el contenido. Intenta de nuevo.');
    }
  }
};
