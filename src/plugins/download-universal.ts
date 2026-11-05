import type { MessageContext, PluginHandler } from '../types/message.js';
import { health, isDownloaderConfigured, NOT_CONFIGURED_MESSAGE, type Quality } from '../lib/downloader-client.js';
import { downloadAuto, extractUrl, platformLabel, URL_REGEX } from '../lib/downloaders.js';
import { getQuotedText } from '../lib/media.js';
import { sendMedias } from '../lib/media-send.js';

interface DownloadMode {
  audioOnly: boolean;
  quality: Quality;
}

const MODE_WORDS: Record<string, Partial<DownloadMode>> = {
  audio: { audioOnly: true },
  mp3: { audioOnly: true },
  hd: { quality: 'best' },
  best: { quality: 'best' },
  low: { quality: 'low' },
  sd: { quality: 'low' },
};

/** Lee "/dl <url> [audio|hd|low]" en cualquier orden de palabras. */
export function parseDownloadArgs(text: string, defaults: DownloadMode): { url: string | null; mode: DownloadMode } {
  const mode: DownloadMode = { ...defaults };
  for (const word of text.toLowerCase().split(/\s+/)) {
    Object.assign(mode, MODE_WORDS[word]);
  }
  return { url: extractUrl(text, undefined, URL_REGEX), mode };
}

async function runDownload(ctx: MessageContext, defaults: DownloadMode, helpText: string): Promise<void> {
  const { conn, m, text, handler } = ctx;
  const parsed = parseDownloadArgs(text, defaults);
  const url = parsed.url ?? extractUrl(undefined, getQuotedText(m));
  if (!url) {
    await m.reply(helpText);
    return;
  }
  if (!isDownloaderConfigured()) {
    await m.reply(`⚠️ ${NOT_CONFIGURED_MESSAGE}`);
    return;
  }

  await m.react('⏳');
  const result = await downloadAuto(url, parsed.mode);
  if (!result.success || !result.medias?.length) {
    await m.react('❌');
    await m.reply(`❌ ${result.error ?? 'No se pudo descargar el contenido.'}`);
    return;
  }

  let caption = platformLabel(result.platform);
  if (result.author) caption += ` | ${result.author}`;
  if (result.title) caption += `\n${result.title.slice(0, 200)}`;
  if (result.medias.length > 1) caption += `\n📦 ${Math.min(result.medias.length, 10)} archivo(s)`;

  const safeTitle = (result.title ?? 'audio').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80);
  const sent = await sendMedias(conn, m, result.medias, {
    caption,
    limit: 10,
    fileName: parsed.mode.audioOnly ? `${safeTitle}.mp3` : undefined,
    trackMessage: (key) => handler.trackMessage(m.chat, key),
  });
  if (sent.sent === 0) {
    await m.react('❌');
    await m.reply(`❌ No se pudo enviar el contenido: ${sent.errors[0] ?? 'WhatsApp rechazó el archivo'}.`);
    return;
  }
  await m.react('✅');
}

export const universalDownloadPlugin: PluginHandler = {
  command: ['dl', 'download', 'descargar', 'bajar', 'ytmp4'],
  description: 'Descarga de cualquier enlace (TikTok, Instagram, YouTube, X, Facebook, Pinterest, Threads y más)',
  category: 'download',
  usage: ['dl <url>', 'dl <url> audio', 'dl <url> hd', 'dl <url> low'],

  handler: (ctx) =>
    runDownload(
      ctx,
      { audioOnly: false, quality: 'medium' },
      '🌐 *DESCARGADOR*\n\n📝 Uso: /dl <url> [audio|hd|low]\n' +
        '• audio: solo el sonido en mp3\n• hd: la mejor calidad disponible\n• low: hasta 480p, archivo más ligero\n\n' +
        'También puedes responder a un mensaje que tenga el enlace.\n' +
        '📌 Plataformas: TikTok, Instagram, Facebook, Twitter/X, Pinterest, Threads, YouTube y cualquier sitio que soporte yt-dlp.',
    ),
};

export const audioDownloadPlugin: PluginHandler = {
  command: ['audio', 'mp3', 'ytmp3'],
  description: 'Descargar solo el audio (mp3) de un video',
  category: 'download',
  usage: ['audio <url>', 'mp3 <url>'],

  handler: (ctx) =>
    runDownload(
      ctx,
      { audioOnly: true, quality: 'medium' },
      '🎵 *AUDIO*\n\n📝 Uso: /audio <url>\nExtrae el audio en mp3 de YouTube, TikTok, Instagram, X y más.\n\nTambién puedes responder a un mensaje que tenga el enlace.',
    ),
};

/**
 * @deprecated /cobalt se retiró: el bot solo usa el servicio propio. Sin
 * comandos no registra nada; quítalo de plugins/index.ts y borra este export.
 */
export const cobaltPlugin: PluginHandler = {
  command: [],
  description: 'Retirado',
  category: 'download',
  handler: async () => undefined,
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min`;
}

export const downloadStatusPlugin: PluginHandler = {
  command: ['dlstatus', 'downloadstatus'],
  description: 'Estado del servicio de descargas',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    if (!isDownloaderConfigured()) {
      await m.reply(`📊 *SERVICIO DE DESCARGAS*\n\n🔴 ${NOT_CONFIGURED_MESSAGE}`);
      return;
    }
    const result = await health();
    if (!result.success) {
      await m.reply(`📊 *SERVICIO DE DESCARGAS*\n\n🔴 Sin respuesta: ${result.message}`);
      return;
    }
    const { data } = result;
    await m.reply(
      '📊 *SERVICIO DE DESCARGAS*\n\n' +
        `${data.status === 'ok' ? '🟢' : '🟡'} Estado: ${data.status}\n` +
        `📦 Versión: ${data.version}\n` +
        `🧰 yt-dlp: ${data.ytdlp ?? 'no encontrado'}\n` +
        `⏱️ Activo desde hace ${formatUptime(data.uptimeSeconds)}\n` +
        `📥 Cola: ${data.queue.active} en curso, ${data.queue.waiting} en espera`,
    );
  },
};
