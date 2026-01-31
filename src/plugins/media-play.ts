/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Busca y envía música desde SoundCloud (principal) y YouTube (respaldo)
 * Usa play-dl para streaming directo sin APIs externas
 */

import play, { SoundCloudTrack } from 'play-dl';
import type { PluginHandler, MessageContext } from '../types/message.js';

// Inicializar cliente de SoundCloud al cargar
let scInitialized = false;

async function initSoundCloud(): Promise<boolean> {
  if (scInitialized) return true;
  try {
    const clientId = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientId } });
    scInitialized = true;
    console.log('✅ SoundCloud inicializado');
    return true;
  } catch (err) {
    console.log('⚠️ No se pudo inicializar SoundCloud:', (err as Error).message);
    return false;
  }
}

// Inicializar al cargar el módulo
initSoundCloud().catch(() => {});

/**
 * Formatea duración de milisegundos a mm:ss
 */
function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formatea duración de segundos a mm:ss
 */
function formatDurationSecs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Convierte un stream a Buffer
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Descarga audio desde SoundCloud usando play-dl
 */
async function downloadFromSoundCloud(url: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    await initSoundCloud();

    console.log('🎵 Descargando desde SoundCloud...');
    const trackInfo = await play.soundcloud(url);

    if (!trackInfo || trackInfo.type !== 'track') {
      console.log('❌ No es un track válido de SoundCloud');
      return null;
    }

    const track = trackInfo as SoundCloudTrack;
    const stream = await play.stream_from_info(track);

    const buffer = await streamToBuffer(stream.stream);

    if (buffer.length < 10000) {
      console.log('❌ Buffer muy pequeño');
      return null;
    }

    console.log('✅ SoundCloud exitoso');
    return {
      buffer,
      title: track.name || 'Audio',
      duration: formatDuration(track.durationInMs || 0)
    };
  } catch (err) {
    console.log('❌ SoundCloud falló:', (err as Error).message);
    return null;
  }
}

/**
 * Busca en SoundCloud y descarga el primer resultado
 */
async function searchAndDownloadSoundCloud(query: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    await initSoundCloud();

    console.log('🔍 Buscando en SoundCloud:', query);
    const results = await play.search(query, { source: { soundcloud: 'tracks' }, limit: 1 });

    if (!results || results.length === 0) {
      console.log('❌ Sin resultados en SoundCloud');
      return null;
    }

    const track = results[0] as SoundCloudTrack;
    console.log('🎵 Encontrado:', track.name);

    const stream = await play.stream_from_info(track);
    const buffer = await streamToBuffer(stream.stream);

    if (buffer.length < 10000) {
      console.log('❌ Buffer muy pequeño');
      return null;
    }

    console.log('✅ SoundCloud exitoso');
    return {
      buffer,
      title: track.name || 'Audio',
      duration: formatDuration(track.durationInMs || 0)
    };
  } catch (err) {
    console.log('❌ Búsqueda SoundCloud falló:', (err as Error).message);
    return null;
  }
}

/**
 * Descarga audio desde YouTube usando play-dl (respaldo)
 */
async function downloadFromYouTube(url: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    console.log('🎵 Intentando YouTube con play-dl...');

    const info = await play.video_basic_info(url);
    const stream = await play.stream(url, { quality: 2 }); // quality 2 = audio only

    const buffer = await streamToBuffer(stream.stream);

    if (buffer.length < 10000) {
      console.log('❌ Buffer muy pequeño');
      return null;
    }

    console.log('✅ YouTube exitoso');
    return {
      buffer,
      title: info.video_details.title || 'Audio',
      duration: formatDurationSecs(info.video_details.durationInSec || 0)
    };
  } catch (err) {
    console.log('❌ YouTube falló:', (err as Error).message);
    return null;
  }
}

/**
 * Busca en YouTube y descarga el primer resultado (respaldo)
 */
async function searchAndDownloadYouTube(query: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    console.log('🔍 Buscando en YouTube:', query);
    const results = await play.search(query, { limit: 1 });

    if (!results || results.length === 0) {
      console.log('❌ Sin resultados en YouTube');
      return null;
    }

    const video = results[0];
    console.log('🎵 Encontrado:', video.title);

    const stream = await play.stream(video.url, { quality: 2 });
    const buffer = await streamToBuffer(stream.stream);

    if (buffer.length < 10000) {
      console.log('❌ Buffer muy pequeño');
      return null;
    }

    console.log('✅ YouTube exitoso');
    return {
      buffer,
      title: video.title || 'Audio',
      duration: video.durationRaw || '0:00'
    };
  } catch (err) {
    console.log('❌ Búsqueda YouTube falló:', (err as Error).message);
    return null;
  }
}

export const playPlugin: PluginHandler = {
  command: /^(play|musica|music|song|cancion)$/i,
  tags: ['media', 'musica'],
  help: [
    'play <nombre> - Busca y envía una canción',
    'play <url> - Descarga de SoundCloud o YouTube'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m, text } = ctx;

    if (!text) {
      return m.reply(
        '🎵 *REPRODUCTOR DE MÚSICA*\n\n' +
        '📝 *Uso:*\n' +
        '• .play Bad Bunny Monaco\n' +
        '• .play <url de SoundCloud>\n' +
        '• .play <url de YouTube>\n\n' +
        '🔍 Busca en SoundCloud y YouTube'
      );
    }

    await m.react('🔍');

    try {
      const isSoundCloudUrl = text.includes('soundcloud.com');
      const isYouTubeUrl = text.includes('youtube.com') || text.includes('youtu.be');

      let result: { buffer: Buffer; title: string; duration: string } | null = null;

      // Caso 1: URL directa de SoundCloud
      if (isSoundCloudUrl) {
        await m.reply('🎵 *Descargando de SoundCloud...*');
        result = await downloadFromSoundCloud(text);
      }
      // Caso 2: URL directa de YouTube
      else if (isYouTubeUrl) {
        await m.reply('🎵 *Descargando de YouTube...*');
        result = await downloadFromYouTube(text);
      }
      // Caso 3: Búsqueda por texto
      else {
        await m.reply('🔍 Buscando: *' + text + '*...');

        // Primero intentar SoundCloud (más estable)
        result = await searchAndDownloadSoundCloud(text);

        // Si falla, intentar YouTube
        if (!result) {
          console.log('⚠️ SoundCloud sin resultados, probando YouTube...');
          result = await searchAndDownloadYouTube(text);
        }
      }

      // Si no se encontró nada
      if (!result) {
        await m.react('❌');
        return m.reply(
          '❌ No se pudo descargar la canción.\n\n' +
          '_Intenta con otro nombre o una URL directa._'
        );
      }

      const { buffer, title, duration } = result;
      const sizeMB = buffer.length / (1024 * 1024);

      await m.reply(
        `🎵 *Enviando...*\n\n` +
        `📀 *${title}*\n` +
        `⏱️ Duración: ${duration}\n` +
        `📦 Tamaño: ${sizeMB.toFixed(1)}MB`
      );

      if (sizeMB > 15) {
        await m.react('⚠️');
        return m.reply(
          `⚠️ El archivo es muy grande (${sizeMB.toFixed(1)}MB).\n` +
          `WhatsApp solo permite archivos de hasta 16MB.`
        );
      }

      await m.react('🎵');

      // Enviar como audio normal (mejor compatibilidad con iPhone usando audio/mp4)
      await conn.sendMessage(m.chat, {
        audio: buffer,
        mimetype: 'audio/mp4',
        ptt: false,
        fileName: `${title}.m4a`
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      await m.react('✅');

    } catch (error) {
      console.error('❌ Error en play:', error);
      await m.react('❌');

      if (error instanceof Error) {
        if (error.message.includes('private')) {
          return m.reply('❌ Este contenido es privado.');
        }
        if (error.message.includes('unavailable') || error.message.includes('not available')) {
          return m.reply('❌ Contenido no disponible.');
        }
      }

      return m.reply('❌ Error al descargar. Intenta con otra canción.');
    }
  }
};

export default playPlugin;
