/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Descarga y envía música desde YouTube usando Cobalt API v10
 */

import play from 'play-dl';
import type { PluginHandler, MessageContext } from '../types/message.js';

/**
 * Formatea duración de segundos a mm:ss
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Descarga audio usando Cobalt API v10
 */
async function downloadWithCobalt(url: string): Promise<Buffer> {
  // Cobalt API v10 formato actualizado
  const instances = [
    { url: 'https://api.cobalt.tools', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } },
    { url: 'https://co.wuk.sh', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } }
  ];

  let lastError: Error | null = null;

  for (const instance of instances) {
    try {
      console.log(`Intentando con ${instance.url}...`);

      const response = await fetch(`${instance.url}/`, {
        method: 'POST',
        headers: instance.headers,
        body: JSON.stringify({
          url: url,
          downloadMode: 'audio',
          audioFormat: 'mp3',
          filenameStyle: 'basic'
        })
      });

      const data = await response.json() as Record<string, unknown>;
      console.log('Cobalt response:', JSON.stringify(data));

      if (data.status === 'error' || data.error) {
        throw new Error((data.error as { code?: string })?.code || data.text as string || 'Cobalt error');
      }

      // La URL del audio puede estar en diferentes campos según la versión
      const audioUrl = (data.url || data.audio) as string | undefined;

      if (!audioUrl) {
        // Si es status picker, tomar el primer item
        if (data.status === 'picker' && Array.isArray(data.picker)) {
          const firstItem = data.picker[0] as { url?: string };
          if (firstItem?.url) {
            const audioResponse = await fetch(firstItem.url);
            if (!audioResponse.ok) throw new Error('Audio download failed');
            return Buffer.from(await audioResponse.arrayBuffer());
          }
        }
        throw new Error('No audio URL in response');
      }

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Audio download failed: ${audioResponse.status}`);
      }

      return Buffer.from(await audioResponse.arrayBuffer());

    } catch (err) {
      lastError = err as Error;
      console.log(`Cobalt ${instance.url} falló:`, (err as Error).message);
      continue;
    }
  }

  throw lastError || new Error('All Cobalt instances failed');
}

/**
 * Descarga usando yt-dlp externo si está disponible
 */
async function downloadWithYtDlp(url: string): Promise<Buffer | null> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const tempFile = path.join(os.tmpdir(), `cyaltronic_${Date.now()}.mp3`);

    // Intentar con yt-dlp
    await execAsync(
      `yt-dlp -x --audio-format mp3 --audio-quality 128K -o "${tempFile}" "${url}"`,
      { timeout: 120000 }
    );

    const buffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});

    return buffer;
  } catch (err) {
    console.log('yt-dlp no disponible o falló:', (err as Error).message);
    return null;
  }
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

      await m.reply(
        `🎵 *Descargando...*\n\n` +
        `📀 *${title}*\n` +
        `⏱️ Duración: ${duration}`
      );

      // Intentar primero con yt-dlp (más estable si está instalado)
      let audioBuffer = await downloadWithYtDlp(videoUrl);

      // Si yt-dlp no está disponible, usar Cobalt
      if (!audioBuffer) {
        audioBuffer = await downloadWithCobalt(videoUrl);
      }

      const sizeMB = audioBuffer.length / (1024 * 1024);

      if (sizeMB > 15) {
        await m.react('⚠️');
        return m.reply(
          `⚠️ El archivo es muy grande (${sizeMB.toFixed(1)}MB).\n` +
          `WhatsApp solo permite archivos de hasta 16MB.`
        );
      }

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
        if (error.message.includes('unavailable') || error.message.includes('not available')) {
          return m.reply('❌ Video no disponible.');
        }
        return m.reply('❌ No se pudo descargar. Intenta con otra canción.');
      }

      return m.reply('❌ Error al descargar. Intenta con otra canción.');
    }
  }
};

export default playPlugin;
