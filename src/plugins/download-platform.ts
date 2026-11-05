import type { MessageContext, PluginHandler } from '../types/message.js';
import { isDownloaderConfigured, NOT_CONFIGURED_MESSAGE } from '../lib/downloader-client.js';
import { downloadAuto, extractUrl, PLATFORMS, platformLabel, type Platform } from '../lib/downloaders.js';
import { getQuotedText } from '../lib/media.js';
import { sendMedias } from '../lib/media-send.js';

export interface DownloadPluginSpec {
  commands: string[];
  platform: Platform;
  /** Casa la URL en el texto o el citado; el esquema es opcional y extractUrl lo completa. */
  urlRegex: RegExp;
  /** Formatos aceptados, se muestran en la ayuda. */
  help: string;
  maxMedias: number;
}

/**
 * Plugin de descarga por plataforma: misma mecánica para todas (URL del
 * texto o del mensaje citado, reacción de progreso, un solo mensaje de error).
 */
export function createDownloadPlugin(spec: DownloadPluginSpec): PluginHandler {
  const { name, emoji } = PLATFORMS[spec.platform];
  const main = spec.commands[0];
  return {
    command: spec.commands,
    description: `Descargar de ${name}`,
    category: 'download',
    usage: [`${main} <url>`, `${main} (respondiendo a un mensaje con el enlace)`],

    async handler(ctx: MessageContext) {
      const { conn, m, text, handler } = ctx;
      const url = extractUrl(text, getQuotedText(m), spec.urlRegex);
      if (!url) {
        const looksLikeUrl = /https?:\/\/|\w\.\w+\//i.test(text);
        await m.reply(
          looksLikeUrl
            ? `❌ Ese enlace no parece de ${name}.\n\n📌 Formatos aceptados:\n${spec.help}`
            : `${emoji} *DESCARGAR ${name.toUpperCase()}*\n\n📝 Uso: /${main} <url>\nTambién puedes responder a un mensaje que tenga el enlace.\n\n📌 Formatos:\n${spec.help}`,
        );
        return;
      }
      if (!isDownloaderConfigured()) {
        await m.reply(`⚠️ ${NOT_CONFIGURED_MESSAGE}`);
        return;
      }

      await m.react('⏳');
      const result = await downloadAuto(url);
      if (!result.success || !result.medias?.length) {
        await m.react('❌');
        await m.reply(`❌ ${result.error ?? 'No se pudo descargar el contenido.'}`);
        return;
      }

      let caption = platformLabel(spec.platform);
      if (result.author) caption += ` | ${result.author}`;
      if (result.title) caption += `\n${result.title.slice(0, 200)}`;
      if (result.medias.length > 1) caption += `\n📦 ${Math.min(result.medias.length, spec.maxMedias)} archivo(s)`;

      const sent = await sendMedias(conn, m, result.medias, {
        caption,
        limit: spec.maxMedias,
        trackMessage: (key) => handler.trackMessage(m.chat, key),
      });
      if (sent.sent === 0) {
        await m.react('❌');
        await m.reply(`❌ No se pudo enviar el contenido: ${sent.errors[0] ?? 'WhatsApp rechazó el archivo'}.`);
        return;
      }
      await m.react('✅');
    },
  };
}

/** Tabla de plataformas; las regex se prueban en tests/descargas-url.test.ts desde aquí. */
export const PLATFORM_SPECS: DownloadPluginSpec[] = [
  {
    commands: ['tiktok', 'tt', 'ttdl'],
    platform: 'tiktok',
    urlRegex: /(?:https?:\/\/)?(?:[\w-]+\.)?tiktok\.com\/[^\s<>"']+/i,
    help: '• tiktok.com/@usuario/video/123\n• vm.tiktok.com/xxx o vt.tiktok.com/xxx',
    maxMedias: 10,
  },
  {
    commands: ['ig', 'instagram', 'igdl'],
    platform: 'instagram',
    urlRegex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv|stories|share)\/[^\s<>"']+/i,
    help: '• instagram.com/p/xxx (post o carrusel)\n• instagram.com/reel/xxx o instagram.com/usuario/reel/xxx\n• instagram.com/share/xxx\n• instagram.com/stories/usuario/123',
    maxMedias: 10,
  },
  {
    commands: ['fb', 'facebook', 'fbdl'],
    platform: 'facebook',
    urlRegex: /(?:https?:\/\/)?(?:[\w-]+\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s<>"']+/i,
    help: '• facebook.com/watch?v=123\n• facebook.com/usuario/videos/123\n• fb.watch/xxx o fb.com/xxx',
    maxMedias: 5,
  },
  {
    commands: ['twitter', 'tw', 'twdl', 'x'],
    platform: 'twitter',
    urlRegex: /(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/(?:i\/|\w+\/)status\/\d+[^\s<>"']*/i,
    help: '• x.com/usuario/status/123\n• twitter.com/usuario/status/123\n• x.com/i/status/123',
    maxMedias: 4,
  },
  {
    commands: ['pinterest'],
    platform: 'pinterest',
    urlRegex: /(?:https?:\/\/)?(?:(?:[\w-]+\.)?pinterest\.(?:com|[a-z]{2}|com?\.[a-z]{2})\/pin\/[^\s<>"']+|pin\.it\/[^\s<>"']+)/i,
    help: '• pinterest.com/pin/123\n• pin.it/xxx',
    maxMedias: 5,
  },
  {
    commands: ['threads', 'th', 'thdl'],
    platform: 'threads',
    urlRegex: /(?:https?:\/\/)?(?:www\.)?threads\.(?:net|com)\/(?:@[\w.]+\/)?post\/[^\s<>"']+/i,
    help: '• threads.net/@usuario/post/xxx\n• threads.com/@usuario/post/xxx',
    maxMedias: 10,
  },
];

const byPlatform = Object.fromEntries(PLATFORM_SPECS.map((spec) => [spec.platform, createDownloadPlugin(spec)])) as Record<Platform, PluginHandler>;

export const tiktokPlugin = byPlatform.tiktok;
export const instagramPlugin = byPlatform.instagram;
export const facebookPlugin = byPlatform.facebook;
export const twitterPlugin = byPlatform.twitter;
export const pinterestPlugin = byPlatform.pinterest;
export const threadsPlugin = byPlatform.threads;

/** Entradas listas para plugins/index.ts: [nombre, plugin]. */
export const platformDownloadPlugins: [string, PluginHandler][] = PLATFORM_SPECS.map((spec) => [`download-${spec.platform}`, byPlatform[spec.platform]]);
