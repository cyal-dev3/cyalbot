/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Busca con play-dl, descarga con API local (Cobalt)
 * SoundCloud como fallback para búsquedas
 */

import play, { SoundCloudTrack, YouTubeVideo } from 'play-dl';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadWithDev3Api } from '../lib/downloaders.js';
import { extractAudioFromVideo } from '../lib/video-converter.js';

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
 * Formatea duración de segundos a mm:ss
 */
function formatDurationSecs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formatea duración de milisegundos a mm:ss
 */
function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  return formatDurationSecs(totalSecs);
}

/**
 * Verifica si una URL es de YouTube
 */
function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

/**
 * Descarga audio usando la API local (Cobalt)
 * Para YouTube: si falla audioOnly, descarga video y extrae audio
 */
async function downloadWithApi(url: string, title?: string, duration?: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    console.log('🎵 Descargando con API (Cobalt):', url);

    // Intentar descargar como audio
    let result = await downloadWithDev3Api(url, true); // audioOnly = true

    // Si falla y es YouTube, intentar descargar video y extraer audio
    if ((!result.success || !result.medias || result.medias.length === 0) && isYouTubeUrl(url)) {
      console.log('⚠️ Audio falló, intentando video + extracción para YouTube...');
      result = await downloadWithDev3Api(url, false, 'low'); // video en baja calidad

      if (result.success && result.medias && result.medias.length > 0) {
        const media = result.medias[0];
        const response = await fetch(media.url);
        const videoBuffer = Buffer.from(await response.arrayBuffer());

        if (videoBuffer.length > 10000) {
          // Extraer audio del video
          const audioBuffer = await extractAudioFromVideo(videoBuffer);

          if (audioBuffer.length > 10000) {
            console.log('✅ Audio extraído exitosamente del video');
            return {
              buffer: audioBuffer,
              title: title || result.title || 'Audio',
              duration: duration || '0:00'
            };
          }
        }
      }

      console.log('❌ También falló el fallback de video');
      return null;
    }

    if (!result.success || !result.medias || result.medias.length === 0) {
      console.log('❌ API falló:', result.error);
      return null;
    }

    const media = result.medias[0];
    const response = await fetch(media.url);
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length < 10000) {
      console.log('❌ Buffer muy pequeño');
      return null;
    }

    console.log('✅ Descarga exitosa con API');
    return {
      buffer,
      title: title || result.title || 'Audio',
      duration: duration || '0:00'
    };
  } catch (err) {
    console.log('❌ Error descargando con API:', (err as Error).message);
    return null;
  }
}

/**
 * Descarga audio desde SoundCloud usando la API
 */
async function downloadFromSoundCloud(url: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    await initSoundCloud();

    // Obtener info del track para el título
    console.log('🎵 Obteniendo info de SoundCloud...');
    const trackInfo = await play.soundcloud(url);

    if (!trackInfo || trackInfo.type !== 'track') {
      console.log('❌ No es un track válido de SoundCloud');
      return null;
    }

    const track = trackInfo as SoundCloudTrack;
    const duration = formatDuration(track.durationInMs || 0);

    // Descargar usando la API
    return await downloadWithApi(url, track.name, duration);
  } catch (err) {
    console.log('❌ SoundCloud falló:', (err as Error).message);
    return null;
  }
}

/**
 * Busca en SoundCloud y descarga usando la API
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
    console.log('🎵 Encontrado en SoundCloud:', track.name);

    const duration = formatDuration(track.durationInMs || 0);

    // Descargar usando la API
    return await downloadWithApi(track.url, track.name, duration);
  } catch (err) {
    console.log('❌ Búsqueda SoundCloud falló:', (err as Error).message);
    return null;
  }
}

/**
 * Descarga audio desde YouTube usando la API (Cobalt)
 */
async function downloadFromYouTube(url: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    // Obtener info del video para título y duración
    console.log('🎵 Obteniendo info de YouTube...');
    const info = await play.video_basic_info(url);
    const title = info.video_details.title || 'Audio';
    const duration = formatDurationSecs(info.video_details.durationInSec || 0);

    // Descargar usando la API (Cobalt)
    return await downloadWithApi(url, title, duration);
  } catch (err) {
    // Si falla obtener info, intentar descargar directamente
    console.log('⚠️ No se pudo obtener info, descargando directamente...');
    return await downloadWithApi(url);
  }
}

/**
 * Busca en YouTube y descarga usando la API (Cobalt)
 */
async function searchAndDownloadYouTube(query: string): Promise<{ buffer: Buffer; title: string; duration: string } | null> {
  try {
    console.log('🔍 Buscando en YouTube:', query);
    const results = await play.search(query, { limit: 1 });

    if (!results || results.length === 0) {
      console.log('❌ Sin resultados en YouTube');
      return null;
    }

    const video = results[0] as YouTubeVideo;
    console.log('🎵 Encontrado en YouTube:', video.title);

    // Descargar usando la API (Cobalt)
    return await downloadWithApi(video.url, video.title, video.durationRaw || '0:00');
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
