import type { MessageContext, PluginHandler } from '../types/message.js';
import {
  describeFailure,
  downloadMedia,
  getInfo,
  isDownloaderConfigured,
  NOT_CONFIGURED_MESSAGE,
  search,
  type SearchSource,
} from '../lib/downloader-client.js';
import { extractUrl, URL_REGEX } from '../lib/downloaders.js';
import { getQuotedText } from '../lib/media.js';
import { sendMedias } from '../lib/media-send.js';

/** Canciones de más de 20 min no caben en los 16 MB de audio de WhatsApp. */
export const MAX_PLAY_SECONDS = 1200;

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '?:??';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'audio';
}

interface Track {
  url: string;
  title: string;
  duration: number | null;
}

/** Resuelve el pedido a una pista: URL directa (con /v1/info) o búsqueda. */
async function resolveTrack(ctx: MessageContext, text: string): Promise<Track | null> {
  const { m } = ctx;
  const url = extractUrl(text, getQuotedText(m), URL_REGEX);
  if (url) {
    const info = await getInfo(url);
    if (!info.success) {
      await m.reply(`❌ ${describeFailure(info)}`);
      return null;
    }
    if (info.data.isPlaylist) {
      await m.reply('❌ Ese enlace es una lista de reproducción; manda el enlace de una sola canción.');
      return null;
    }
    return { url, title: info.data.title ?? 'Audio', duration: info.data.duration };
  }

  let source: SearchSource = 'youtube';
  // Sin texto propio se busca lo que dice el mensaje citado (si no traía un enlace).
  let query = text.trim() || getQuotedText(m).trim().slice(0, 120);
  const scMatch = query.match(/^(?:sc|soundcloud)\s+(.+)$/i);
  if (scMatch) {
    source = 'soundcloud';
    query = scMatch[1];
  }
  const found = await search(query, { limit: 1, source });
  if (!found.success) {
    await m.reply(
      found.code === 'UNSUPPORTED' && source === 'soundcloud'
        ? '❌ La búsqueda en SoundCloud no está disponible por ahora; prueba sin "sc" para buscar en YouTube.'
        : `❌ ${describeFailure(found)}`,
    );
    return null;
  }
  const first = found.data[0];
  if (!first) {
    await m.reply(`❌ No encontré nada para *${query}*.`);
    return null;
  }
  return { url: first.url, title: first.title, duration: first.duration };
}

export const playPlugin: PluginHandler = {
  command: ['play', 'musica', 'music', 'song', 'cancion', 'canción'],
  description: 'Buscar una canción en YouTube y enviarla como audio',
  category: 'media',
  usage: ['play <nombre de la canción>', 'play <url de YouTube u otro sitio>'],

  async handler(ctx: MessageContext) {
    const { conn, m, text, handler } = ctx;
    if (!text.trim() && !getQuotedText(m).trim()) {
      await m.reply('🎵 *PLAY*\n\n📝 Uso:\n• /play Bad Bunny Monaco\n• /play <url de YouTube>\n\nBusca en YouTube y manda el audio en mp3.');
      return;
    }
    if (!isDownloaderConfigured()) {
      await m.reply(`⚠️ ${NOT_CONFIGURED_MESSAGE}`);
      return;
    }

    await m.react('🔍');
    const track = await resolveTrack(ctx, text);
    if (!track) {
      await m.react('❌');
      return;
    }
    if (track.duration !== null && track.duration > MAX_PLAY_SECONDS) {
      await m.react('❌');
      await m.reply(`❌ *${track.title}* dura ${formatDuration(track.duration)}; el máximo es ${MAX_PLAY_SECONDS / 60} minutos.`);
      return;
    }

    await m.reply(`🎵 Encontré: *${track.title}* (${formatDuration(track.duration)})\n_Descargando..._`);
    await m.react('⏳');

    const result = await downloadMedia(track.url, { audioOnly: true });
    if (!result.success) {
      await m.react('❌');
      await m.reply(`❌ ${describeFailure(result)}`);
      return;
    }
    const title = result.data.title ?? track.title;
    const sent = await sendMedias(conn, m, result.data.medias.map((media) => ({ ...media })), {
      limit: 1,
      fileName: `${safeFileName(title)}.mp3`,
      trackMessage: (key) => handler.trackMessage(m.chat, key),
    });
    if (sent.sent === 0) {
      await m.react('❌');
      await m.reply(`❌ No se pudo enviar el audio: ${sent.errors[0] ?? 'WhatsApp rechazó el archivo'}.`);
      return;
    }
    await m.react('✅');
  },
};
