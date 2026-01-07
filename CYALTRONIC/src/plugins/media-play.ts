/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Descarga y envía música desde YouTube con múltiples APIs de respaldo
 */

import play from 'play-dl';
import type { PluginHandler, MessageContext } from '../types/message.js';

// yt-dlp debe estar instalado en el sistema (pip install yt-dlp o apt install yt-dlp)
const YT_DLP_PATH = 'yt-dlp';

/**
 * Formatea duración de segundos a mm:ss
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Valida que el buffer sea un MP3 válido y tenga tamaño mínimo
 */
function validateAudio(buffer: Buffer): boolean {
  if (buffer.length < 100000) return false; // Mínimo 100KB
  // Verificar header MP3 (ID3 o Frame sync)
  const isId3 = buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33;
  const isFrameSync = buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0;
  return isId3 || isFrameSync;
}

/**
 * Descarga buffer desde URL con timeout
 */
async function downloadBuffer(url: string, timeout = 30000): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * API 1: ogmp3 (apiapi.lat) - Más confiable
 */
async function downloadWithOgmp3(videoId: string): Promise<Buffer | null> {
  try {
    console.log('🎵 Intentando ogmp3 (apiapi.lat)...');

    const hash = () => {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    };

    const encode = (str: string) => {
      let result = '';
      for (let i = 0; i < str.length; i++) {
        result += String.fromCharCode(str.charCodeAt(i) ^ 1);
      }
      return result;
    };

    const url = `https://youtube.com/watch?v=${videoId}`;
    const endpoints = ['https://api5.apiapi.lat', 'https://api.apiapi.lat', 'https://api3.apiapi.lat'];
    const base = endpoints[Math.floor(Math.random() * endpoints.length)];

    const encUrl = url.split('').map(c => c.charCodeAt(0)).reverse().join(',');
    const c = hash(), d = hash();

    const response = await fetch(`${base}/${c}/init/${encUrl}/${d}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://ogmp3.lat',
        'Referer': 'https://ogmp3.lat/'
      },
      body: JSON.stringify({
        data: encode(url),
        format: '0',
        mp3Quality: '320',
        userTimeZone: new Date().getTimezoneOffset().toString()
      })
    });

    const data = await response.json() as Record<string, unknown>;

    if (data.s === 'C' && data.i) {
      const downloadUrl = `https://api3.apiapi.lat/${hash()}/download/${encode(data.i as string)}/${hash()}/`;
      const buffer = await downloadBuffer(downloadUrl);
      if (validateAudio(buffer)) {
        console.log('✅ ogmp3 exitoso');
        return buffer;
      }
    }

    // Si está procesando, esperar
    if (data.i && data.s === 'P') {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${base}/${hash()}/status/${encode(data.i as string)}/${hash()}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data.i })
        });
        const status = await statusRes.json() as Record<string, unknown>;
        if (status.s === 'C') {
          const downloadUrl = `https://api3.apiapi.lat/${hash()}/download/${encode(status.i as string)}/${hash()}/`;
          const buffer = await downloadBuffer(downloadUrl);
          if (validateAudio(buffer)) {
            console.log('✅ ogmp3 exitoso');
            return buffer;
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.log('❌ ogmp3 falló:', (err as Error).message);
    return null;
  }
}

/**
 * API 2: Cobalt API
 */
async function downloadWithCobalt(url: string): Promise<Buffer | null> {
  const instances = [
    'https://api.cobalt.tools',
    'https://co.wuk.sh'
  ];

  for (const instance of instances) {
    try {
      console.log(`🎵 Intentando Cobalt ${instance}...`);

      const response = await fetch(`${instance}/`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          downloadMode: 'audio',
          audioFormat: 'mp3',
          filenameStyle: 'basic'
        })
      });

      const data = await response.json() as Record<string, unknown>;

      if (data.status === 'error') continue;

      const audioUrl = (data.url || data.audio) as string | undefined;
      if (audioUrl) {
        const buffer = await downloadBuffer(audioUrl);
        if (validateAudio(buffer)) {
          console.log('✅ Cobalt exitoso');
          return buffer;
        }
      }

      if (data.status === 'picker' && Array.isArray(data.picker)) {
        const firstItem = data.picker[0] as { url?: string };
        if (firstItem?.url) {
          const buffer = await downloadBuffer(firstItem.url);
          if (validateAudio(buffer)) return buffer;
        }
      }
    } catch (err) {
      console.log(`❌ Cobalt ${instance} falló:`, (err as Error).message);
    }
  }

  return null;
}

/**
 * API 3: APIs alternativas
 */
async function downloadWithAlternatives(videoUrl: string): Promise<Buffer | null> {
  const apis = [
    {
      name: 'vreden',
      url: `https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`,
      extract: (data: Record<string, unknown>) => (data.result as Record<string, unknown>)?.download as Record<string, unknown> | undefined
    },
    {
      name: 'nyxs',
      url: `https://api.nyxs.pw/dl/yt-direct?url=${encodeURIComponent(videoUrl)}`,
      extract: (data: Record<string, unknown>) => ({ url: (data.result as Record<string, unknown>)?.audioUrl })
    }
  ];

  for (const api of apis) {
    try {
      console.log(`🎵 Intentando ${api.name}...`);
      const response = await fetch(api.url, { signal: AbortSignal.timeout(30000) });
      const data = await response.json() as Record<string, unknown>;

      if (!data.status) continue;

      const result = api.extract(data);
      const downloadUrl = (result?.url || result) as string | undefined;

      if (downloadUrl && typeof downloadUrl === 'string') {
        const buffer = await downloadBuffer(downloadUrl);
        if (validateAudio(buffer)) {
          console.log(`✅ ${api.name} exitoso`);
          return buffer;
        }
      }
    } catch (err) {
      console.log(`❌ ${api.name} falló:`, (err as Error).message);
    }
  }

  return null;
}

/**
 * API 4: yt-dlp local (más estable)
 */
async function downloadWithYtDlp(url: string): Promise<Buffer | null> {
  try {
    console.log('🎵 Intentando yt-dlp local...');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const tempFile = path.join(os.tmpdir(), `cyaltronic_${Date.now()}.mp3`);

    await execAsync(
      `"${YT_DLP_PATH}" -x --audio-format mp3 --audio-quality 128K --no-playlist -o "${tempFile}" "${url}"`,
      { timeout: 120000 }
    );

    const buffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});

    if (validateAudio(buffer)) {
      console.log('✅ yt-dlp exitoso');
      return buffer;
    }
    return null;
  } catch (err) {
    console.log('❌ yt-dlp falló:', (err as Error).message);
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

      // Extraer videoId para ogmp3
      const videoIdMatch = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const videoId = videoIdMatch ? videoIdMatch[1] : null;

      let audioBuffer: Buffer | null = null;
      const errors: string[] = [];

      // Intento 1: yt-dlp local (más estable)
      audioBuffer = await downloadWithYtDlp(videoUrl);
      if (!audioBuffer) errors.push('yt-dlp');

      // Intento 2: ogmp3 (apiapi.lat)
      if (!audioBuffer && videoId) {
        audioBuffer = await downloadWithOgmp3(videoId);
        if (!audioBuffer) errors.push('ogmp3');
      }

      // Intento 3: Cobalt API
      if (!audioBuffer) {
        audioBuffer = await downloadWithCobalt(videoUrl);
        if (!audioBuffer) errors.push('cobalt');
      }

      // Intento 4: APIs alternativas
      if (!audioBuffer) {
        audioBuffer = await downloadWithAlternatives(videoUrl);
        if (!audioBuffer) errors.push('alternativas');
      }

      // Si ninguna API funcionó
      if (!audioBuffer) {
        await m.react('❌');
        console.log('❌ Todas las APIs fallaron:', errors.join(', '));
        return m.reply('❌ No se pudo descargar. Todas las APIs fallaron. Intenta con otra canción.');
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
      }

      return m.reply('❌ Error al descargar. Intenta con otra canción.');
    }
  }
};

export default playPlugin;
