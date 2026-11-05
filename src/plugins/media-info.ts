import type { MessageContext, PluginHandler } from '../types/message.js';
import { describeFailure, getInfo, isDownloaderConfigured, NOT_CONFIGURED_MESSAGE } from '../lib/downloader-client.js';
import { detectPlatform, extractUrl, PLATFORMS, URL_REGEX } from '../lib/downloaders.js';
import { getQuotedText } from '../lib/media.js';
import { fetchMedia } from '../lib/media-send.js';
import { formatDuration } from './media-play.js';

const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

export const mediaInfoPlugin: PluginHandler = {
  // 'info' lo tiene rpg-inventario (iteminfo), por eso el principal es videoinfo.
  command: ['videoinfo', 'linkinfo', 'dlinfo'],
  description: 'Título, autor y duración de un enlace sin descargarlo',
  category: 'download',
  usage: ['videoinfo <url>'],

  async handler(ctx: MessageContext) {
    const { m, text, send } = ctx;
    const url = extractUrl(text, getQuotedText(m), URL_REGEX);
    if (!url) {
      await m.reply('ℹ️ *INFO DE ENLACE*\n\n📝 Uso: /videoinfo <url>\nMuestra título, autor, duración y plataforma del enlace sin descargarlo.');
      return;
    }
    if (!isDownloaderConfigured()) {
      await m.reply(`⚠️ ${NOT_CONFIGURED_MESSAGE}`);
      return;
    }

    await m.react('⏳');
    const result = await getInfo(url);
    if (!result.success) {
      await m.react('❌');
      await m.reply(`❌ ${describeFailure(result)}`);
      return;
    }
    const info = result.data;
    const platform = info.platform ?? PLATFORMS[detectPlatform(url)].name;
    const lines = [
      `ℹ️ *${info.title ?? 'Sin título'}*`,
      info.author ? `👤 ${info.author}` : null,
      info.isPlaylist ? `📚 Lista con ${info.entries} elemento(s)` : `⏱️ ${formatDuration(info.duration)}`,
      `🌐 ${platform}`,
    ].filter((line): line is string => line !== null);
    const caption = lines.join('\n');

    const thumbnail = info.thumbnail ? await fetchMedia(info.thumbnail, { maxBytes: THUMBNAIL_MAX_BYTES, timeoutMs: 15_000 }) : null;
    if (thumbnail && thumbnail.mimetype.startsWith('image/')) {
      await send({ image: thumbnail.buffer, caption }, { quoted: m.rawMessage });
    } else {
      await m.reply(caption);
    }
    await m.react('✅');
  },
};
