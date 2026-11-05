import type { MessageContext, PluginHandler } from '../types/message.js';
import { getQuotedOrOwnMedia, replyMediaError } from '../lib/media.js';
import { formatMb, LIMITS } from '../lib/media-send.js';
import { compressVideo } from '../lib/video-converter.js';

/** Objetivo: que el resultado se pueda reenviar como video normal (16 MB es el tope cómodo en móviles). */
const TARGET_BYTES = 16 * 1024 * 1024;

export const comprimirPlugin: PluginHandler = {
  command: ['comprimir', 'compress', 'compactar'],
  description: 'Comprimir un video (480p) para que pese menos',
  category: 'media',
  usage: ['comprimir (respondiendo a un video)'],

  async handler(ctx: MessageContext) {
    const { m, send } = ctx;
    try {
      const media = await getQuotedOrOwnMedia(ctx, ['video'], { maxBytes: LIMITS.video });
      if (!media) {
        await m.reply('🗜️ *COMPRIMIR*\n\nResponde a un video con /comprimir para recibirlo en 480p y con menos peso.');
        return;
      }
      await m.react('⏳');
      const compressed = await compressVideo(media.buffer, { crf: 30, maxHeight: 480 });
      const saved = media.buffer.length > 0 ? Math.round((1 - compressed.length / media.buffer.length) * 100) : 0;
      let caption = `🗜️ ${formatMb(media.buffer.length)} → ${formatMb(compressed.length)}`;
      if (saved > 0) caption += ` (${saved}% menos)`;
      if (compressed.length > TARGET_BYTES) caption += '\n⚠️ Sigue pesando más de 16 MB; algunos teléfonos no lo reproducirán en línea.';
      await send({ video: compressed, mimetype: 'video/mp4', caption }, { quoted: m.rawMessage });
      await m.react('✅');
    } catch (error) {
      await m.react('❌');
      await replyMediaError(m, error, '❌ No se pudo comprimir el video.');
    }
  },
};
