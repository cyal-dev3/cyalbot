/**
 * 📌 Plugin de Búsqueda en Pinterest
 * Comando: /pinterest
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

/**
 * Busca imágenes en Pinterest
 */
async function searchPinterest(query: string): Promise<{
  success: boolean;
  images?: string[];
  error?: string;
}> {
  try {
    // Usar API de Pinterest (scraping)
    const searchUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${encodeURIComponent(query)}&data={"options":{"query":"${query}","scope":"pins"},"context":{}}`;

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    const data = await response.json() as {
      resource_response?: {
        data?: {
          results?: Array<{
            images?: {
              orig?: { url?: string };
              '736x'?: { url?: string };
            };
          }>;
        };
      };
    };

    const results = data.resource_response?.data?.results;
    if (!results || results.length === 0) {
      // Método alternativo: usar API simple
      return await searchPinterestAlternative(query);
    }

    const images: string[] = [];
    for (const pin of results) {
      const imgUrl = pin.images?.orig?.url || pin.images?.['736x']?.url;
      if (imgUrl && !images.includes(imgUrl)) {
        images.push(imgUrl);
      }
      if (images.length >= 5) break;
    }

    return { success: true, images };
  } catch {
    return await searchPinterestAlternative(query);
  }
}

/**
 * Método alternativo de búsqueda en Pinterest
 */
async function searchPinterestAlternative(query: string): Promise<{
  success: boolean;
  images?: string[];
  error?: string;
}> {
  try {
    // Usar una API pública alternativa
    const apiUrl = `https://api.lolhuman.xyz/api/pinterest?apikey=free&query=${encodeURIComponent(query)}`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const data = await response.json() as {
      status?: number;
      result?: string[];
    };

    if (data.status !== 200 || !data.result || data.result.length === 0) {
      // Último intento: usar Google Images como fallback
      return {
        success: false,
        error: 'No se encontraron imágenes para esta búsqueda'
      };
    }

    return {
      success: true,
      images: data.result.slice(0, 5)
    };
  } catch (error) {
    console.error('Error en Pinterest alternativo:', error);
    return { success: false, error: 'Error al buscar imágenes' };
  }
}

/**
 * Comando /pinterest - Buscar imágenes en Pinterest
 */
export const pinterestPlugin: PluginHandler = {
  command: ['pinterest', 'pin'],
  description: 'Buscar imágenes en Pinterest',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    if (!text.trim()) {
      await m.reply('📌 *BUSCAR EN PINTEREST*\n\n📝 Uso: /pinterest <búsqueda>\n\n📌 Ejemplo:\n/pinterest paisajes hermosos\n/pinterest anime wallpaper');
      return;
    }

    await m.react('⏳');

    const result = await searchPinterest(text.trim());

    if (!result.success || !result.images || result.images.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se encontraron imágenes'}`);
      return;
    }

    try {
      // Enviar primera imagen con caption
      const firstResponse = await fetch(result.images[0]);
      const firstBuffer = Buffer.from(await firstResponse.arrayBuffer());

      await conn.sendMessage(m.chat, {
        image: firstBuffer,
        caption: `📌 *Pinterest*\n\n🔎 Búsqueda: ${text.trim()}\n📦 ${result.images.length} imagen(es) encontrada(s)`
      }, { quoted: m.rawMessage });

      // Enviar el resto de imágenes
      for (let i = 1; i < result.images.length; i++) {
        try {
          const response = await fetch(result.images[i]);
          const buffer = Buffer.from(await response.arrayBuffer());

          await conn.sendMessage(m.chat, {
            image: buffer
          });
        } catch {
          // Ignorar errores individuales
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
};
