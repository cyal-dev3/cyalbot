import type { MessageContext, PluginHandler } from '../types/message.js';
import { getQuotedOrOwnMedia, replyMediaError } from '../lib/media.js';
import { stickerToImage } from '../lib/sticker.js';

export const toImagePlugin: PluginHandler = {
  command: ['toimg', 'toimage', 'img', 'imagen'],
  description: 'Convertir un sticker en imagen',
  category: 'media',
  usage: ['toimg (respondiendo a un sticker)'],

  async handler(ctx: MessageContext) {
    const { m, send } = ctx;
    try {
      const media = await getQuotedOrOwnMedia(ctx, ['sticker']);
      if (!media) {
        await m.reply('🖼️ *STICKER A IMAGEN*\n\nResponde a un sticker con /toimg para recibirlo como imagen PNG.');
        return;
      }
      await m.react('⏳');
      const image = await stickerToImage(media.buffer);
      await send({ image, mimetype: 'image/png', caption: media.isAnimated ? '🖼️ Primer fotograma del sticker' : undefined }, { quoted: m.rawMessage });
      await m.react('✅');
    } catch (error) {
      await m.react('❌');
      await replyMediaError(m, error, '❌ No se pudo convertir el sticker en imagen.');
    }
  },
};
