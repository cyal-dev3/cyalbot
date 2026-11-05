import type { AnyMessageContent } from 'baileys';
import type { MessageContext, PluginHandler } from '../types/message.js';
import { getQuotedOrOwnMedia, replyMediaError } from '../lib/media.js';
import { isAnimatedWebp, stickerToGif, stickerToVideo } from '../lib/sticker.js';

interface ConvertSpec {
  commands: string[];
  description: string;
  title: string;
  target: 'video' | 'gif';
}

/**
 * /tovideo y /togif comparten todo salvo el formato de salida. Para GIF se
 * manda un video con gifPlayback (WhatsApp no reproduce GIF reales); con la
 * palabra "file" se envía el .gif como documento.
 */
function createStickerConvertPlugin(spec: ConvertSpec): PluginHandler {
  const main = spec.commands[0];
  return {
    command: spec.commands,
    description: spec.description,
    category: 'media',
    usage: spec.target === 'gif' ? [`${main} (respondiendo a un sticker animado)`, `${main} file → como archivo .gif`] : [`${main} (respondiendo a un sticker animado)`],

    async handler(ctx: MessageContext) {
      const { m, text, send } = ctx;
      try {
        const media = await getQuotedOrOwnMedia(ctx, ['sticker']);
        if (!media) {
          await m.reply(`${spec.title}\n\nResponde a un sticker animado con /${main}.`);
          return;
        }
        // Lo que declara WhatsApp no siempre es fiable; el WebP dice la verdad.
        if (!isAnimatedWebp(media.buffer)) {
          await m.reply('❌ Ese sticker no es animado. Usa /toimg para convertirlo en imagen.');
          return;
        }
        await m.react('⏳');

        let content: AnyMessageContent;
        if (spec.target === 'video') {
          content = { video: await stickerToVideo(media.buffer), mimetype: 'video/mp4' };
        } else if (/\bfile\b|\barchivo\b/i.test(text)) {
          content = { document: await stickerToGif(media.buffer), mimetype: 'image/gif', fileName: 'sticker.gif' };
        } else {
          content = { video: await stickerToVideo(media.buffer), mimetype: 'video/mp4', gifPlayback: true };
        }
        await send(content, { quoted: m.rawMessage });
        await m.react('✅');
      } catch (error) {
        await m.react('❌');
        await replyMediaError(m, error, '❌ No se pudo convertir el sticker.');
      }
    },
  };
}

export const toVideoPlugin = createStickerConvertPlugin({
  commands: ['tovideo', 'tovid', 'video'],
  description: 'Convertir un sticker animado en video',
  title: '🎬 *STICKER A VIDEO*',
  target: 'video',
});

export const toGifPlugin = createStickerConvertPlugin({
  commands: ['togif', 'gif'],
  description: 'Convertir un sticker animado en GIF',
  title: '🎞️ *STICKER A GIF*',
  target: 'gif',
});
