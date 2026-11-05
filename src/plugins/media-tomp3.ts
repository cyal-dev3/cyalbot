import type { MessageContext, PluginHandler } from '../types/message.js';
import { getQuotedOrOwnMedia, replyMediaError } from '../lib/media.js';
import { LIMITS } from '../lib/media-send.js';
import { extractAudioFromVideo } from '../lib/video-converter.js';

export const toMp3Plugin: PluginHandler = {
  command: ['tomp3', 'toaudio'],
  description: 'Extraer el audio (mp3) de un video',
  category: 'media',
  usage: ['tomp3 (respondiendo a un video)'],

  async handler(ctx: MessageContext) {
    const { m, send } = ctx;
    try {
      const media = await getQuotedOrOwnMedia(ctx, ['video'], { maxBytes: LIMITS.video });
      if (!media) {
        await m.reply('🎵 *TO MP3*\n\nResponde a un video con /tomp3 para recibir solo su audio en mp3.');
        return;
      }
      await m.react('⏳');
      const audio = await extractAudioFromVideo(media.buffer, 'mp3');
      if (audio.length > LIMITS.audio) {
        await m.react('❌');
        await m.reply(`⚠️ El audio pesa ${(audio.length / (1024 * 1024)).toFixed(1)} MB; WhatsApp solo acepta audios de hasta 16 MB.`);
        return;
      }
      await send({ audio, mimetype: 'audio/mpeg', ptt: false, fileName: 'audio.mp3' }, { quoted: m.rawMessage });
      await m.react('✅');
    } catch (error) {
      await m.react('❌');
      await replyMediaError(m, error, '❌ No se pudo extraer el audio del video.');
    }
  },
};
