/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Descarga y envía música desde YouTube, Spotify y SoundCloud
 * Usa @distube/ytdl-core como método principal (más estable)
 */

import play from 'play-dl';
import ytdl from '@distube/ytdl-core';
import type { PluginHandler, MessageContext } from '../types/message.js';

// Configurar play-dl para no usar cookies (evita errores)
play.setToken({
  useragent: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36']
});

/**
 * Descarga audio usando @distube/ytdl-core (más estable)
 */
async function downloadWithYtdl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    });

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err: Error) => reject(err));
  });
}

/**
 * Detecta el tipo de URL o si es una búsqueda
 */
function detectSource(query: string): 'youtube' | 'spotify' | 'soundcloud' | 'search' {
  if (query.includes('youtube.com') || query.includes('youtu.be')) {
    return 'youtube';
  }
  if (query.includes('spotify.com')) {
    return 'spotify';
  }
  if (query.includes('soundcloud.com')) {
    return 'soundcloud';
  }
  return 'search';
}

/**
 * Formatea duración de segundos a mm:ss
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const playPlugin: PluginHandler = {
  command: /^(play|musica|music|song|cancion)$/i,
  tags: ['media', 'musica'],
  help: [
    'play <nombre> - Busca y envía una canción',
    'play <url youtube> - Descarga de YouTube',
    'play <url spotify> - Descarga desde Spotify',
    'play <url soundcloud> - Descarga de SoundCloud'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m, text } = ctx;

    if (!text) {
      return m.reply(
        '🎵 *REPRODUCTOR DE MÚSICA*\n\n' +
        '📝 *Uso:*\n' +
        '• .play Bad Bunny Monaco\n' +
        '• .play https://youtube.com/watch?v=...\n' +
        '• .play https://open.spotify.com/track/...\n' +
        '• .play https://soundcloud.com/...\n\n' +
        '🔍 Soporta: YouTube, Spotify y SoundCloud'
      );
    }

    // Reaccionar para indicar que está procesando
    await m.react('🔍');

    try {
      const source = detectSource(text);
      let videoUrl: string;
      let title: string;
      let duration: string;
      let thumbnail: string | undefined;

      if (source === 'search') {
        // Buscar en YouTube
        await m.reply('🔍 Buscando: *' + text + '*...');

        const searchResults = await play.search(text, { limit: 1 });

        if (!searchResults || searchResults.length === 0) {
          await m.react('❌');
          return m.reply('❌ No se encontraron resultados para: ' + text);
        }

        const result = searchResults[0];
        videoUrl = result.url;
        title = result.title || 'Sin título';
        duration = result.durationRaw || '0:00';
        thumbnail = result.thumbnails?.[0]?.url;

      } else if (source === 'youtube') {
        // URL directa de YouTube
        videoUrl = text;

        const info = await play.video_basic_info(text);
        title = info.video_details.title || 'Sin título';
        duration = formatDuration(info.video_details.durationInSec || 0);
        thumbnail = info.video_details.thumbnails?.[0]?.url;

      } else if (source === 'spotify') {
        // Spotify - obtener info y buscar en YouTube
        await m.reply('🎧 Obteniendo info de Spotify...');

        if (play.is_expired()) {
          await play.refreshToken();
        }

        const spotifyInfo = await play.spotify(text);

        if (!spotifyInfo || spotifyInfo.type !== 'track') {
          await m.react('❌');
          return m.reply('❌ Solo se soportan tracks individuales de Spotify, no playlists ni álbumes.');
        }

        const trackName = spotifyInfo.name;
        // @ts-ignore - play-dl types are incomplete for Spotify
        const artistName = (spotifyInfo as any).artists?.[0]?.name || '';
        const searchQuery = `${trackName} ${artistName}`;

        // Buscar en YouTube
        const searchResults = await play.search(searchQuery, { limit: 1 });

        if (!searchResults || searchResults.length === 0) {
          await m.react('❌');
          return m.reply('❌ No se encontró el audio en YouTube.');
        }

        videoUrl = searchResults[0].url;
        title = `${trackName} - ${artistName}`;
        duration = searchResults[0].durationRaw || '0:00';
        // @ts-ignore - play-dl types are incomplete
        thumbnail = (spotifyInfo as any).thumbnail?.url || searchResults[0].thumbnails?.[0]?.url;

      } else if (source === 'soundcloud') {
        // SoundCloud
        const scInfo = await play.soundcloud(text);

        if (!scInfo || scInfo.type !== 'track') {
          await m.react('❌');
          return m.reply('❌ Solo se soportan tracks individuales de SoundCloud.');
        }

        videoUrl = text;
        title = scInfo.name || 'Sin título';
        duration = formatDuration(scInfo.durationInSec || 0);
        // @ts-ignore - play-dl types are incomplete for SoundCloud
        thumbnail = (scInfo as any).thumbnail;

      } else {
        await m.react('❌');
        return m.reply('❌ Fuente no soportada.');
      }

      // Notificar que está descargando
      await m.reply(
        `🎵 *Descargando...*\n\n` +
        `📀 *${title}*\n` +
        `⏱️ Duración: ${duration}`
      );

      // Obtener audio buffer
      let audioBuffer: Buffer;

      if (source === 'soundcloud') {
        // SoundCloud usa play-dl
        const audioStream = await play.stream(videoUrl, { quality: 2 });
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream.stream) {
          chunks.push(Buffer.from(chunk));
        }
        audioBuffer = Buffer.concat(chunks);
      } else {
        // YouTube usa @distube/ytdl-core (más estable)
        try {
          audioBuffer = await downloadWithYtdl(videoUrl);
        } catch (ytdlError) {
          // Fallback a play-dl si ytdl falla
          console.log('ytdl-core falló, intentando con play-dl...');
          const audioStream = await play.stream(videoUrl, { quality: 2 });
          const chunks: Buffer[] = [];
          for await (const chunk of audioStream.stream) {
            chunks.push(Buffer.from(chunk));
          }
          audioBuffer = Buffer.concat(chunks);
        }
      }

      // Verificar tamaño (WhatsApp tiene límite de ~16MB para audio)
      const sizeMB = audioBuffer.length / (1024 * 1024);

      if (sizeMB > 15) {
        await m.react('⚠️');
        return m.reply(
          `⚠️ El archivo es muy grande (${sizeMB.toFixed(1)}MB).\n` +
          `WhatsApp solo permite archivos de hasta 16MB.`
        );
      }

      // Enviar audio
      await m.react('🎵');

      await conn.sendMessage(m.chat, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: false, // false = audio normal, true = nota de voz
        fileName: `${title}.mp3`
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      // Confirmar envío
      await m.react('✅');

    } catch (error) {
      console.error('❌ Error en play:', error);
      await m.react('❌');

      if (error instanceof Error) {
        if (error.message.includes('Sign in')) {
          return m.reply('❌ YouTube requiere autenticación. Intenta con otra canción.');
        }
        if (error.message.includes('private')) {
          return m.reply('❌ Este video es privado.');
        }
        if (error.message.includes('unavailable')) {
          return m.reply('❌ Video no disponible en tu región.');
        }
        return m.reply(`❌ Error: ${error.message.substring(0, 100)}`);
      }

      return m.reply('❌ Error al descargar la música. Intenta con otra canción.');
    }
  }
};

export default playPlugin;
