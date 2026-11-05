/**
 * Plugin Sticker a Imagen
 * Convierte stickers a imágenes PNG
 * Comando: .toimg, .toimage, .img
 */

import { downloadMediaMessage } from 'baileys';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { stickerToImage } from '../lib/sticker.js';

export const toImagePlugin: PluginHandler = {
  command: /^(toimg|toimage|img|imagen)$/i,
  tags: ['sticker', 'media'],
  help: [
    'toimg - Responde a un sticker para convertirlo a imagen',
    'img - Alias de toimg'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m } = ctx;

    // Verificar que se respondió a un mensaje
    const quotedMsg = m.quoted;

    if (!quotedMsg || !quotedMsg.message) {
      return m.reply(
        '🖼️ *STICKER A IMAGEN*\n\n' +
        '*Uso:*\n' +
        'Responde a un sticker con .toimg\n\n' +
        '*Ejemplo:*\n' +
        '• Responde a cualquier sticker con .toimg'
      );
    }

    // Verificar que es un sticker
    const message = quotedMsg.message;

    if (!message.stickerMessage) {
      return m.reply('❌ Debes responder a un *sticker*, no a otro tipo de mensaje.');
    }

    try {
      await m.react('🔄');

      // Descargar el sticker
      const downloadMsg = {
        key: quotedMsg.key,
        message: quotedMsg.message
      };

      const stickerBuffer = await downloadMediaMessage(
        downloadMsg,
        'buffer',
        {},
        {
          logger: console as any,
          reuploadRequest: conn.updateMediaMessage
        }
      ) as Buffer;

      // Convertir a imagen
      const imageBuffer = await stickerToImage(stickerBuffer);

      // Enviar imagen
      await conn.sendMessage(m.chat, {
        image: imageBuffer,
        caption: '🖼️ Sticker convertido a imagen',
        mimetype: 'image/png'
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      await m.react('✅');

    } catch (error) {
      console.error('❌ Error convirtiendo sticker a imagen:', error);
      await m.react('❌');

      if (error instanceof Error) {
        if (error.message.includes('ffmpeg')) {
          return m.reply('❌ Error de conversión. Asegúrate de que ffmpeg esté instalado.');
        }
        return m.reply(`❌ Error: ${error.message.substring(0, 100)}`);
      }

      return m.reply('❌ Error al convertir el sticker. Intenta con otro.');
    }
  }
};

export default toImagePlugin;
