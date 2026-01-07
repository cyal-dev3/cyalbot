/**
 * 🎵 Plugin de Música - CYALTRONIC
 * Descarga y envía música desde YouTube con múltiples APIs de respaldo
 */

import play from 'play-dl';
import type { PluginHandler, MessageContext } from '../types/message.js';

// yt-dlp debe estar instalado en el sistema (pip install yt-dlp o apt install yt-dlp)
const YT_DLP_PATH = 'yt-dlp';

// PO Token para evitar bloqueos de YouTube (más seguro que cookies)
// Genera el token siguiendo: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
// O instala el plugin: pip install bgutil-ytdlp-pot-provider
const PO_TOKEN = process.env.YT_PO_TOKEN || '';
const VISITOR_DATA = process.env.YT_VISITOR_DATA || '';

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
  if (buffer.length < 50000) return false; // Mínimo 50KB
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
 * API 1: yt-dlp local con soporte de PO Token (más seguro que cookies)
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

    // Construir argumentos para PO Token si está configurado
    let poTokenArgs = '';
    if (PO_TOKEN && VISITOR_DATA) {
      // Usar cliente mweb con PO Token (recomendado por yt-dlp)
      poTokenArgs = `--extractor-args "youtube:player_client=mweb;po_token=mweb.gvs+${PO_TOKEN}" --extractor-args "youtubetab:skip=webpage" --extractor-args "youtube:visitor_data=${VISITOR_DATA}"`;
      console.log('🔐 Usando PO Token con cliente mweb');
    } else if (PO_TOKEN) {
      poTokenArgs = `--extractor-args "youtube:player_client=mweb;po_token=mweb.gvs+${PO_TOKEN}"`;
      console.log('🔐 Usando PO Token');
    }

    const command = `${YT_DLP_PATH} -x --audio-format mp3 --audio-quality 128K --no-playlist ${poTokenArgs} -o "${tempFile}" "${url}"`;

    await execAsync(command, { timeout: 120000 });

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

/**
 * API 2: y2mate (muy confiable)
 */
async function downloadWithY2mate(videoId: string): Promise<Buffer | null> {
  try {
    console.log('🎵 Intentando y2mate...');

    // Paso 1: Analizar video
    const analyzeRes = await fetch('https://www.y2mate.com/mates/analyzeV2/ajax', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.y2mate.com',
        'Referer': 'https://www.y2mate.com/'
      },
      body: `k_query=https://www.youtube.com/watch?v=${videoId}&k_page=home&hl=en&q_auto=1`
    });

    const analyzeData = await analyzeRes.json() as Record<string, unknown>;

    if (analyzeData.status !== 'ok') {
      throw new Error('y2mate analyze failed');
    }

    // Obtener el ID de conversión para MP3 128kbps
    const links = analyzeData.links as Record<string, Record<string, { k: string; size: string }>>;
    const mp3Links = links?.mp3;

    if (!mp3Links) throw new Error('No MP3 links found');

    // Buscar 128kbps o el primero disponible
    const mp3Key = mp3Links['mp3128']?.k || Object.values(mp3Links)[0]?.k;

    if (!mp3Key) throw new Error('No MP3 key found');

    // Paso 2: Convertir
    const convertRes = await fetch('https://www.y2mate.com/mates/convertV2/index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.y2mate.com',
        'Referer': 'https://www.y2mate.com/'
      },
      body: `vid=${videoId}&k=${encodeURIComponent(mp3Key)}`
    });

    const convertData = await convertRes.json() as Record<string, unknown>;

    if (convertData.status !== 'ok' || !convertData.dlink) {
      throw new Error('y2mate convert failed');
    }

    const buffer = await downloadBuffer(convertData.dlink as string);

    if (validateAudio(buffer)) {
      console.log('✅ y2mate exitoso');
      return buffer;
    }

    return null;
  } catch (err) {
    console.log('❌ y2mate falló:', (err as Error).message);
    return null;
  }
}

/**
 * API 3: ssyoutube (mp3download.to)
 */
async function downloadWithSsyoutube(videoId: string): Promise<Buffer | null> {
  try {
    console.log('🎵 Intentando ssyoutube...');

    const response = await fetch(`https://api.mp3download.to/v1/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        format: 'mp3',
        quality: '128'
      })
    });

    const data = await response.json() as Record<string, unknown>;

    if (data.error) throw new Error(data.error as string);

    // Si devuelve URL directa
    if (data.url) {
      const buffer = await downloadBuffer(data.url as string);
      if (validateAudio(buffer)) {
        console.log('✅ ssyoutube exitoso');
        return buffer;
      }
    }

    // Si necesita polling
    if (data.id) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`https://api.mp3download.to/v1/status/${data.id}`);
        const statusData = await statusRes.json() as Record<string, unknown>;

        if (statusData.status === 'completed' && statusData.url) {
          const buffer = await downloadBuffer(statusData.url as string);
          if (validateAudio(buffer)) {
            console.log('✅ ssyoutube exitoso');
            return buffer;
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.log('❌ ssyoutube falló:', (err as Error).message);
    return null;
  }
}

/**
 * API 4: Cobalt API (instancias públicas)
 */
async function downloadWithCobalt(url: string): Promise<Buffer | null> {
  const instances = [
    { url: 'https://api.cobalt.tools', apiKey: null },
    { url: 'https://cobalt.canine.tools', apiKey: null },
    { url: 'https://dwnld.nichol.as', apiKey: null }
  ];

  for (const instance of instances) {
    try {
      console.log(`🎵 Intentando Cobalt ${instance.url}...`);

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      if (instance.apiKey) {
        headers['Authorization'] = `Api-Key ${instance.apiKey}`;
      }

      const response = await fetch(`${instance.url}/`, {
        method: 'POST',
        headers,
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
      console.log(`❌ Cobalt ${instance.url} falló:`, (err as Error).message);
    }
  }

  return null;
}

/**
 * API 5: APIs de respaldo adicionales
 */
async function downloadWithBackupApis(videoUrl: string, videoId: string): Promise<Buffer | null> {
  const apis = [
    {
      name: 'tomp3',
      fetch: async () => {
        const res = await fetch(`https://tomp3.cc/api/ajax/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `query=${encodeURIComponent(videoUrl)}&vt=mp3`
        });
        const data = await res.json() as Record<string, unknown>;
        if (data.status === 'ok' && data.url) {
          return downloadBuffer(data.url as string);
        }
        return null;
      }
    },
    {
      name: 'savefrom',
      fetch: async () => {
        const res = await fetch(`https://worker.sf-tools.com/savefrom.php?url=${encodeURIComponent(videoUrl)}`, {
          headers: { 'Origin': 'https://savefrom.net' }
        });
        const data = await res.json() as Record<string, unknown>[];
        const audio = data?.find((d: Record<string, unknown>) => d.type === 'audio');
        if (audio?.url) {
          return downloadBuffer(audio.url as string);
        }
        return null;
      }
    },
    {
      name: 'ytmp3-api',
      fetch: async () => {
        const res = await fetch(`https://api.vevioz.com/api/button/mp3/${videoId}`);
        const html = await res.text();
        const match = html.match(/href="(https:\/\/[^"]+\.mp3[^"]*)"/);
        if (match?.[1]) {
          return downloadBuffer(match[1]);
        }
        return null;
      }
    }
  ];

  for (const api of apis) {
    try {
      console.log(`🎵 Intentando ${api.name}...`);
      const buffer = await api.fetch();
      if (buffer && validateAudio(buffer)) {
        console.log(`✅ ${api.name} exitoso`);
        return buffer;
      }
    } catch (err) {
      console.log(`❌ ${api.name} falló:`, (err as Error).message);
    }
  }

  return null;
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

      // Extraer videoId
      const videoIdMatch = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      const videoId = videoIdMatch ? videoIdMatch[1] : null;

      if (!videoId) {
        await m.react('❌');
        return m.reply('❌ No se pudo extraer el ID del video.');
      }

      let audioBuffer: Buffer | null = null;
      const errors: string[] = [];

      // Intento 1: yt-dlp local (con cookies si existen)
      audioBuffer = await downloadWithYtDlp(videoUrl);
      if (!audioBuffer) errors.push('yt-dlp');

      // Intento 2: y2mate
      if (!audioBuffer) {
        audioBuffer = await downloadWithY2mate(videoId);
        if (!audioBuffer) errors.push('y2mate');
      }

      // Intento 3: ssyoutube
      if (!audioBuffer) {
        audioBuffer = await downloadWithSsyoutube(videoId);
        if (!audioBuffer) errors.push('ssyoutube');
      }

      // Intento 4: Cobalt API
      if (!audioBuffer) {
        audioBuffer = await downloadWithCobalt(videoUrl);
        if (!audioBuffer) errors.push('cobalt');
      }

      // Intento 5: APIs de respaldo
      if (!audioBuffer) {
        audioBuffer = await downloadWithBackupApis(videoUrl, videoId);
        if (!audioBuffer) errors.push('backup-apis');
      }

      // Si ninguna API funcionó
      if (!audioBuffer) {
        await m.react('❌');
        console.log('❌ Todas las APIs fallaron:', errors.join(', '));
        return m.reply(
          '❌ No se pudo descargar la canción.\n\n' +
          '_Tip: Si el problema persiste, configura cookies de YouTube._'
        );
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
