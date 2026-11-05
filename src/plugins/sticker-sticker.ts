/**
 * Plugin de Stickers
 * Convierte imágenes, videos y GIFs a stickers
 * Comando: .s, .sticker, .stiker
 */

import { downloadMediaMessage } from 'baileys';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { createSticker, videoToSticker, imageToSticker } from '../lib/sticker.js';

/**
 * Verifica si una URL es válida para imágenes
 */
function isImageUrl(text: string): boolean {
  const urlPattern = /https?:\/\/[^\s]+\.(jpe?g|png|gif|webp)(\?[^\s]*)?/i;
  return urlPattern.test(text);
}

/**
 * Descarga contenido de una URL
 */
async function downloadFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error descargando: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export const stickerPlugin: PluginHandler = {
  command: /^(s|sticker|stiker|stick)$/i,
  tags: ['sticker', 'media'],
  help: [
    's - Responde a una imagen/video para crear sticker',
    's <url> - Crea sticker desde una URL de imagen',
    'sticker - Alias de s'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m, text } = ctx;

    // Obtener el mensaje que contiene la media
    const quotedMsg = m.quoted;
    let mediaBuffer: Buffer | null = null;
    let mediaType: 'image' | 'video' | 'sticker' | null = null;

    try {
      // Caso 1: Se proporcionó una URL
      if (text && isImageUrl(text)) {
        await m.react('🔄');
        mediaBuffer = await downloadFromUrl(text);
        mediaType = 'image';
      }
      // Caso 2: Se respondió a un mensaje con media
      else if (quotedMsg && quotedMsg.message) {
        await m.react('🔄');

        const message = quotedMsg.message;

        // Detectar tipo de media
        if (message.imageMessage) {
          mediaType = 'image';
        } else if (message.videoMessage) {
          mediaType = 'video';
        } else if (message.stickerMessage) {
          // Si ya es sticker, lo devolvemos como está (útil para robar stickers)
          mediaType = 'sticker';
        } else {
          await m.react('❌');
          return m.reply(
            '❌ *Error*\n\n' +
            'Debes responder a una imagen, video o GIF.\n\n' +
            '*Ejemplo:*\n' +
            '• Responde a una imagen con .s\n' +
            '• .s https://ejemplo.com/imagen.jpg'
          );
        }

        // Descargar la media
        const downloadMsg = {
          key: quotedMsg.key,
          message: quotedMsg.message
        };

        mediaBuffer = await downloadMediaMessage(
          downloadMsg,
          'buffer',
          {},
          {
            logger: console as any,
            reuploadRequest: conn.updateMediaMessage
          }
        ) as Buffer;
      }
      // Caso 3: Mensaje actual tiene media (enviaron imagen con comando en caption)
      else if (m.rawMessage?.message) {
        const rawMsg = m.rawMessage;

        if (rawMsg.message?.imageMessage) {
          await m.react('🔄');
          mediaType = 'image';
          mediaBuffer = await downloadMediaMessage(
            rawMsg,
            'buffer',
            {},
            {
              logger: console as any,
              reuploadRequest: conn.updateMediaMessage
            }
          ) as Buffer;
        } else if (rawMsg.message?.videoMessage) {
          await m.react('🔄');
          mediaType = 'video';
          mediaBuffer = await downloadMediaMessage(
            rawMsg,
            'buffer',
            {},
            {
              logger: console as any,
              reuploadRequest: conn.updateMediaMessage
            }
          ) as Buffer;
        }
      }

      // Si no hay media, mostrar ayuda
      if (!mediaBuffer) {
        return m.reply(
          '🎨 *CREAR STICKER*\n\n' +
          '*Uso:*\n' +
          '• Responde a una imagen/video con .s\n' +
          '• Envía una imagen con .s en el caption\n' +
          '• .s <url de imagen>\n\n' +
          '*Tipos soportados:*\n' +
          '📷 Imágenes (JPG, PNG, WEBP)\n' +
          '🎬 Videos cortos (máx 6 segundos)\n' +
          '🎞️ GIFs animados'
        );
      }

      // Verificar tamaño (máximo 5MB para videos, el sticker se comprimirá)
      if (mediaBuffer.length > 5 * 1024 * 1024 && mediaType === 'video') {
        await m.react('⚠️');
        return m.reply('⚠️ El video es muy grande. Intenta con uno más corto (máx 8 segundos).');
      }

      // Crear el sticker según el tipo de media
      const stickerMetadata = {
        packname: 'CYALTRONIC',
        author: m.pushName || 'User',
        categories: ['🎨']
      };

      let stickerBuffer: Buffer;

      // Usar la función específica para cada tipo para mejor resultado
      if (mediaType === 'video') {
        // Forzar uso de videoToSticker para videos
        stickerBuffer = await videoToSticker(mediaBuffer, stickerMetadata);
      } else {
        // Para imágenes y stickers usar la detección automática
        stickerBuffer = await createSticker(mediaBuffer, stickerMetadata);
      }

      // Enviar sticker
      await conn.sendMessage(m.chat, {
        sticker: stickerBuffer
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      await m.react('✅');

    } catch (error) {
      console.error('❌ Error creando sticker:', error);
      await m.react('❌');

      if (error instanceof Error) {
        if (error.message.includes('ffmpeg')) {
          return m.reply('❌ Error de conversión. Asegúrate de que ffmpeg esté instalado.');
        }
        return m.reply(`❌ Error: ${error.message.substring(0, 100)}`);
      }

      return m.reply('❌ Error al crear el sticker. Intenta con otra imagen o video.');
    }
  }
};

export default stickerPlugin;
