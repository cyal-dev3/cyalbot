/**
 * Plugin Sticker a Video/GIF
 * Convierte stickers animados a video o GIF
 * Comando: .tovideo, .tovid, .togif
 */

import { downloadMediaMessage } from 'baileys';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { stickerToVideo, stickerToGif } from '../lib/sticker.js';

export const toVideoPlugin: PluginHandler = {
  command: /^(tovideo|tovid|video)$/i,
  tags: ['sticker', 'media'],
  help: [
    'tovideo - Responde a un sticker animado para convertirlo a video',
    'tovid - Alias de tovideo'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m } = ctx;

    // Verificar que se respondió a un mensaje
    const quotedMsg = m.quoted;

    if (!quotedMsg || !quotedMsg.message) {
      return m.reply(
        '🎬 *STICKER A VIDEO*\n\n' +
        '*Uso:*\n' +
        'Responde a un sticker animado con .tovideo\n\n' +
        '*Nota:*\n' +
        'Solo funciona con stickers animados (GIFs)'
      );
    }

    // Verificar que es un sticker
    const message = quotedMsg.message;

    if (!message.stickerMessage) {
      return m.reply('❌ Debes responder a un *sticker*, no a otro tipo de mensaje.');
    }

    // Verificar si es animado
    const isAnimated = message.stickerMessage.isAnimated;

    if (!isAnimated) {
      return m.reply('❌ Este sticker no es animado. Usa .toimg para stickers estáticos.');
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

      // Convertir a video
      const videoBuffer = await stickerToVideo(stickerBuffer);

      // Enviar video
      await conn.sendMessage(m.chat, {
        video: videoBuffer,
        caption: '🎬 Sticker convertido a video',
        mimetype: 'video/mp4',
        gifPlayback: true // Reproducir como GIF
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      await m.react('✅');

    } catch (error) {
      console.error('❌ Error convirtiendo sticker a video:', error);
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

export const toGifPlugin: PluginHandler = {
  command: /^(togif|gif)$/i,
  tags: ['sticker', 'media'],
  help: [
    'togif - Responde a un sticker animado para convertirlo a GIF',
    'gif - Alias de togif'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m } = ctx;

    // Verificar que se respondió a un mensaje
    const quotedMsg = m.quoted;

    if (!quotedMsg || !quotedMsg.message) {
      return m.reply(
        '🎞️ *STICKER A GIF*\n\n' +
        '*Uso:*\n' +
        'Responde a un sticker animado con .togif\n\n' +
        '*Nota:*\n' +
        'Solo funciona con stickers animados'
      );
    }

    // Verificar que es un sticker
    const message = quotedMsg.message;

    if (!message.stickerMessage) {
      return m.reply('❌ Debes responder a un *sticker*, no a otro tipo de mensaje.');
    }

    // Verificar si es animado
    const isAnimated = message.stickerMessage.isAnimated;

    if (!isAnimated) {
      return m.reply('❌ Este sticker no es animado. Usa .toimg para stickers estáticos.');
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

      // Convertir a GIF
      const gifBuffer = await stickerToGif(stickerBuffer);

      // Enviar como documento GIF
      await conn.sendMessage(m.chat, {
        document: gifBuffer,
        fileName: 'sticker.gif',
        mimetype: 'image/gif',
        caption: '🎞️ Sticker convertido a GIF'
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      await m.react('✅');

    } catch (error) {
      console.error('❌ Error convirtiendo sticker a GIF:', error);
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

export default { toVideoPlugin, toGifPlugin };
