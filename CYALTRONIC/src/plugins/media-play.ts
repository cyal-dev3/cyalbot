/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Descarga y envía música desde YouTube usando Cobalt API
 */

import play from 'play-dl';
import type { PluginHandler, MessageContext } from '../types/message.js';

// Lista de instancias de Cobalt públicas (fallback)
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://cobalt-api.hyper.lol',
  'https://cobalt.api.timelessnesses.me'
];

/**
 * Formatea duración de segundos a mm:ss
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Descarga audio usando Cobalt API
 */
async function downloadWithCobalt(url: string): Promise<Buffer> {
  let lastError: Error | null = null;

  for (const instance of COBALT_INSTANCES) {
    try {
      const response = await fetch(instance, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: url,
          downloadMode: 'audio',
          audioFormat: 'mp3',
          audioBitrate: '128'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as { status: string; url?: string; error?: string };

      if (data.status === 'error') {
        throw new Error(data.error || 'Cobalt error');
      }

      if (data.status === 'redirect' || data.status === 'tunnel') {
        // Descargar el audio desde la URL proporcionada
        const audioUrl = data.url;
        if (!audioUrl) throw new Error('No audio URL');

        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
          throw new Error(`Audio download failed: ${audioResponse.status}`);
        }

        const arrayBuffer = await audioResponse.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      throw new Error('Unexpected Cobalt response');
    } catch (err) {
      lastError = err as Error;
      console.log(`Cobalt instance ${instance} falló:`, (err as Error).message);
      continue;
    }
  }

  throw lastError || new Error('All Cobalt instances failed');
}

export const playPlugin: PluginHandler = {
  command: /^(play|musica|music|song|cancion)$/i,
  tags: ['media', 'musica'],
  help: [
    'play <nombre> - Busca y envía una canción',
    'play <url youtube> - Descarga de YouTube'
  ],

  handler: async (ctx: MessageContext) => {
    const { conn, m, text } = ctx;

    if (!text) {
      return m.reply(
        '🎵 *REPRODUCTOR DE MÚSICA*\n\n' +
        '📝 *Uso:*\n' +
        '• .play Bad Bunny Monaco\n' +
        '• .play https://youtube.com/watch?v=...\n\n' +
        '🔍 Busca canciones en YouTube'
      );
    }

    await m.react('🔍');

    try {
      let videoUrl: string;
      let title: string;
      let duration: string;

      const isUrl = text.includes('youtube.com') || text.includes('youtu.be');

      if (isUrl) {
        // URL directa de YouTube
        videoUrl = text;
        await m.reply('🎵 *Obteniendo info...*');

        try {
          const info = await play.video_basic_info(text);
          title = info.video_details.title || 'Sin título';
          duration = formatDuration(info.video_details.durationInSec || 0);
        } catch {
          title = 'Audio de YouTube';
          duration = '??:??';
        }

      } else {
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
      }

      // Notificar que está descargando
      await m.reply(
        `🎵 *Descargando...*\n\n` +
        `📀 *${title}*\n` +
        `⏱️ Duración: ${duration}`
      );

      // Descargar usando Cobalt
      const audioBuffer = await downloadWithCobalt(videoUrl);

      // Verificar tamaño
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
        ptt: false,
        fileName: `${title}.mp3`
      }, { quoted: m.key.id ? { key: m.key, message: {} } : undefined });

      await m.react('✅');

    } catch (error) {
      console.error('❌ Error en play:', error);
      await m.react('❌');

      if (error instanceof Error) {
        if (error.message.includes('private')) {
          return m.reply('❌ Este video es privado.');
        }
        if (error.message.includes('unavailable')) {
          return m.reply('❌ Video no disponible.');
        }
        if (error.message.includes('Cobalt')) {
          return m.reply('❌ Servicio de descarga no disponible. Intenta más tarde.');
        }
        return m.reply(`❌ Error: ${error.message.substring(0, 100)}`);
      }

      return m.reply('❌ Error al descargar. Intenta con otra canción.');
    }
  }
};

export default playPlugin;
