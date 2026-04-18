/**
 * 📥 Librería Universal de Descargadores - CYALTRONIC
 * APIs múltiples con fallbacks para máxima confiabilidad
 */

import { CONFIG } from '../config.js';

// Tipos comunes
export interface DownloadResult {
  success: boolean;
  medias?: MediaItem[];
  title?: string;
  author?: string;
  description?: string;
  error?: string;
}

export interface MediaItem {
  url: string;
  type: 'video' | 'image' | 'audio';
  quality?: string;
  thumbnail?: string;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 15000;

// ============================================================
// 🚀 DEV3-DOWNLOADER API (LOCAL - PRINCIPAL)
// ============================================================

interface Dev3ApiResponse {
  success: boolean;
  data?: {
    url: string;
    type: 'video' | 'audio';
    filename: string;
    size?: number;
    duration?: number;
    thumbnail?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    engine: string;
    requestId: string;
    durationMs: number;
  };
}

/**
 * Descarga usando la API local dev3-downloader (Cobalt + yt-dlp)
 * Esta es la opción más rápida y confiable
 */
export async function downloadWithDev3Api(url: string, audioOnly = false, quality: 'best' | 'medium' | 'low' = 'medium'): Promise<DownloadResult> {
  try {
    const response = await fetch(`${CONFIG.downloaderApi.url}/v1/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        quality, // medium = 720p (compatible con WhatsApp)
        audioOnly,
      }),
      signal: AbortSignal.timeout(CONFIG.downloaderApi.timeout),
    });

    const data = await response.json() as Dev3ApiResponse;

    if (!data.success || !data.data) {
      return {
        success: false,
        error: data.error?.message || 'dev3-downloader: respuesta inválida',
      };
    }

    return {
      success: true,
      medias: [{
        url: data.data.url,
        type: data.data.type === 'audio' ? 'audio' : 'video',
        quality,
        thumbnail: data.data.thumbnail,
      }],
      title: data.data.filename,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    console.log('❌ dev3-downloader API falló:', message);
    return { success: false, error: `dev3-downloader: ${message}` };
  }
}

/**
 * Verifica si la API local está disponible
 */
export async function isDev3ApiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.downloaderApi.url}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json() as { status: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

// ============================================================
// 🎵 TIKTOK DOWNLOADERS
// ============================================================

export async function downloadTikTok(url: string): Promise<DownloadResult> {
  // 🚀 PRIMERA OPCIÓN: API local dev3-downloader
  try {
    const result = await downloadWithDev3Api(url);
    if (result.success) {
      console.log('✅ dev3-downloader: TikTok descargado');
      return result;
    }
  } catch (e) {
    console.log('⚠️ dev3-downloader no disponible para TikTok');
  }

  // API 2: TikWM (fallback)
  try {
    const result = await tikwmDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ TikWM falló:', (e as Error).message);
  }

  // API 3: SnapTik
  try {
    const result = await snaptikDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SnapTik falló:', (e as Error).message);
  }

  // API 4: SSSTik
  try {
    const result = await ssstikDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SSSTik falló:', (e as Error).message);
  }

  return { success: false, error: 'No se pudo descargar el video de TikTok' };
}

async function tikwmDownload(url: string): Promise<DownloadResult> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as {
    code: number;
    data?: {
      play?: string;
      hdplay?: string;
      wmplay?: string;
      music?: string;
      title?: string;
      author?: { nickname?: string };
      images?: string[];
    };
  };

  if (data.code !== 0 || !data.data) {
    return { success: false, error: 'TikWM: respuesta inválida' };
  }

  const medias: MediaItem[] = [];

  // Si es slideshow (imágenes)
  if (data.data.images && data.data.images.length > 0) {
    for (const img of data.data.images) {
      medias.push({ url: img, type: 'image' });
    }
  } else {
    // Video normal
    const videoUrl = data.data.hdplay || data.data.play;
    if (videoUrl) {
      medias.push({ url: videoUrl, type: 'video', quality: data.data.hdplay ? 'HD' : 'SD' });
    }
  }

  if (medias.length === 0) {
    return { success: false, error: 'TikWM: no se encontró media' };
  }

  return {
    success: true,
    medias,
    title: data.data.title,
    author: data.data.author?.nickname
  };
}

async function snaptikDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://snaptik.app/abc2.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `url=${encodeURIComponent(url)}`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();

  // Buscar URLs de video en el HTML
  const videoMatches = html.match(/(?:href|src)=["'](https:\/\/[^"']+\.mp4[^"']*)["']/gi);
  if (!videoMatches || videoMatches.length === 0) {
    return { success: false, error: 'SnapTik: no se encontró video' };
  }

  const videoUrl = videoMatches[0].match(/["'](https:\/\/[^"']+)["']/)?.[1];
  if (!videoUrl) {
    return { success: false, error: 'SnapTik: URL inválida' };
  }

  return {
    success: true,
    medias: [{ url: videoUrl, type: 'video' }]
  };
}

async function ssstikDownload(url: string): Promise<DownloadResult> {
  // Primero obtener el token
  const pageResponse = await fetch('https://ssstik.io/en', {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  const pageHtml = await pageResponse.text();
  const tokenMatch = pageHtml.match(/name="tt" value="([^"]+)"/);
  if (!tokenMatch) {
    return { success: false, error: 'SSSTik: no se encontró token' };
  }

  const response = await fetch('https://ssstik.io/abc?url=dl', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `id=${encodeURIComponent(url)}&locale=en&tt=${tokenMatch[1]}`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const videoMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*>Without watermark/i);
  if (!videoMatch) {
    return { success: false, error: 'SSSTik: no se encontró video' };
  }

  return {
    success: true,
    medias: [{ url: videoMatch[1], type: 'video' }]
  };
}

// ============================================================
// 📸 INSTAGRAM DOWNLOADERS
// ============================================================

export async function downloadInstagram(url: string): Promise<DownloadResult> {
  // 🚀 PRIMERA OPCIÓN: API local dev3-downloader
  try {
    const result = await downloadWithDev3Api(url);
    if (result.success) {
      console.log('✅ dev3-downloader: Instagram descargado');
      return result;
    }
  } catch (e) {
    console.log('⚠️ dev3-downloader no disponible para Instagram');
  }

  // API 2: IGDownloader (fallback)
  try {
    const result = await igdownloaderDownload(url);
    if (result.success && result.medias && result.medias.length > 0) return result;
  } catch (e) {
    console.log('❌ IGDownloader falló:', (e as Error).message);
  }

  // API 3: SaveIG
  try {
    const result = await saveigDownload(url);
    if (result.success && result.medias && result.medias.length > 0) return result;
  } catch (e) {
    console.log('❌ SaveIG falló:', (e as Error).message);
  }

  // API 4: FastDL
  try {
    const result = await fastdlInstagramDownload(url);
    if (result.success && result.medias && result.medias.length > 0) return result;
  } catch (e) {
    console.log('❌ FastDL falló:', (e as Error).message);
  }

  // API 5: SnapInsta
  try {
    const result = await snapinstaDownload(url);
    if (result.success && result.medias && result.medias.length > 0) return result;
  } catch (e) {
    console.log('❌ SnapInsta falló:', (e as Error).message);
  }

  return { success: false, error: 'No se pudo descargar el contenido de Instagram' };
}

async function igdownloaderDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://v3.igdownloader.app/api/ajaxSearch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `recaptchaToken=&q=${encodeURIComponent(url)}&t=media&lang=en`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as { status: string; data?: string };
  if (data.status !== 'ok' || !data.data) {
    return { success: false, error: 'IGDownloader: respuesta inválida' };
  }

  const medias: MediaItem[] = [];

  // Buscar videos
  const videoMatches = data.data.matchAll(/"(https:\/\/[^"]+\.mp4[^"]*)"/gi);
  for (const match of videoMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'video' });
    }
  }

  // Buscar imágenes
  const imageMatches = data.data.matchAll(/"(https:\/\/[^"]+(?:\.jpg|\.jpeg|\.png|\.webp)[^"]*)"/gi);
  for (const match of imageMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'image' });
    }
  }

  return { success: medias.length > 0, medias };
}

async function saveigDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://saveig.app/api/ajaxSearch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `q=${encodeURIComponent(url)}&t=media&lang=en`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as { status: string; data?: string };
  if (data.status !== 'ok' || !data.data) {
    return { success: false, error: 'SaveIG: respuesta inválida' };
  }

  const medias: MediaItem[] = [];
  const urlMatches = data.data.matchAll(/(https:\/\/[^"<>\s]+(?:\.mp4|\.jpg|\.jpeg|\.png|\.webp))/gi);
  for (const match of urlMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      const isVideo = match[1].toLowerCase().includes('.mp4');
      medias.push({ url: match[1], type: isVideo ? 'video' : 'image' });
    }
  }

  return { success: medias.length > 0, medias };
}

async function fastdlInstagramDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://fastdl.app/api/convert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as {
    status: string;
    result?: Array<{ url: string; type: string }>;
  };

  if (data.status !== 'success' || !data.result) {
    return { success: false, error: 'FastDL: respuesta inválida' };
  }

  const medias: MediaItem[] = data.result.map(item => ({
    url: item.url,
    type: item.type === 'video' ? 'video' : 'image'
  }));

  return { success: medias.length > 0, medias };
}

async function snapinstaDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://snapinsta.app/action2.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `url=${encodeURIComponent(url)}`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const medias: MediaItem[] = [];

  // Buscar videos
  const videoMatches = html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/gi);
  for (const match of videoMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'video' });
    }
  }

  // Buscar imágenes
  const imgMatches = html.matchAll(/href="(https:\/\/[^"]+(?:\.jpg|\.jpeg|\.png)[^"]*)"/gi);
  for (const match of imgMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'image' });
    }
  }

  return { success: medias.length > 0, medias };
}

// ============================================================
// 📘 FACEBOOK DOWNLOADERS
// ============================================================

export async function downloadFacebook(url: string): Promise<DownloadResult> {
  // 🚀 PRIMERA OPCIÓN: API local dev3-downloader
  try {
    const result = await downloadWithDev3Api(url);
    if (result.success) {
      console.log('✅ dev3-downloader: Facebook descargado');
      return result;
    }
  } catch (e) {
    console.log('⚠️ dev3-downloader no disponible para Facebook');
  }

  // API 2: FDown (fallback)
  try {
    const result = await fdownDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ FDown falló:', (e as Error).message);
  }

  // API 3: SnapSave
  try {
    const result = await snapsaveFacebookDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SnapSave falló:', (e as Error).message);
  }

  // API 4: GetFVid
  try {
    const result = await getfvidDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ GetFVid falló:', (e as Error).message);
  }

  return { success: false, error: 'No se pudo descargar el video de Facebook' };
}

async function fdownDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://fdown.net/download.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `URLz=${encodeURIComponent(url)}`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const hdMatch = html.match(/href="(https:\/\/[^"]+)" id="hdlink"/);
  const sdMatch = html.match(/href="(https:\/\/[^"]+)" id="sdlink"/);

  if (!hdMatch && !sdMatch) {
    // Intento alternativo
    const altMatch = html.match(/href="(https:\/\/video[^"]+\.mp4[^"]*)"/);
    if (altMatch) {
      return {
        success: true,
        medias: [{ url: altMatch[1], type: 'video', quality: 'SD' }]
      };
    }
    return { success: false, error: 'FDown: no se encontró video' };
  }

  const medias: MediaItem[] = [];
  if (hdMatch) medias.push({ url: hdMatch[1], type: 'video', quality: 'HD' });
  else if (sdMatch) medias.push({ url: sdMatch[1], type: 'video', quality: 'SD' });

  return { success: true, medias };
}

async function snapsaveFacebookDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://snapsave.app/action.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `url=${encodeURIComponent(url)}`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const videoMatches = html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/gi);
  const medias: MediaItem[] = [];

  for (const match of videoMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'video' });
    }
  }

  return { success: medias.length > 0, medias };
}

async function getfvidDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://getfvid.com/downloader', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `url=${encodeURIComponent(url)}`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const hdMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*>.*?HD/i);
  const sdMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*>.*?Normal/i);

  if (!hdMatch && !sdMatch) {
    return { success: false, error: 'GetFVid: no se encontró video' };
  }

  const medias: MediaItem[] = [];
  if (hdMatch) medias.push({ url: hdMatch[1], type: 'video', quality: 'HD' });
  else if (sdMatch) medias.push({ url: sdMatch[1], type: 'video', quality: 'SD' });

  return { success: true, medias };
}

// ============================================================
// 🐦 TWITTER/X DOWNLOADERS
// ============================================================

export async function downloadTwitter(url: string): Promise<DownloadResult> {
  // 🚀 PRIMERA OPCIÓN: API local dev3-downloader
  try {
    const result = await downloadWithDev3Api(url);
    if (result.success) {
      console.log('✅ dev3-downloader: Twitter descargado');
      return result;
    }
  } catch (e) {
    console.log('⚠️ dev3-downloader no disponible para Twitter');
  }

  // API 2: TwitSave (fallback)
  try {
    const result = await twitsaveDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ TwitSave falló:', (e as Error).message);
  }

  // API 3: SSSTwitter
  try {
    const result = await ssstwitterDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SSSTwitter falló:', (e as Error).message);
  }

  // API 4: SaveTwitter
  try {
    const result = await savetwitterDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SaveTwitter falló:', (e as Error).message);
  }

  return { success: false, error: 'No se pudo descargar el video de Twitter/X' };
}

async function twitsaveDownload(url: string): Promise<DownloadResult> {
  const apiUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const videoMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i) ||
    html.match(/src="(https:\/\/[^"]+\.mp4[^"]*)"/i);

  if (!videoMatch) {
    return { success: false, error: 'TwitSave: no se encontró video' };
  }

  // Extraer info adicional
  const textMatch = html.match(/<p class="[^"]*tweet-text[^"]*">([^<]+)<\/p>/i);
  const authorMatch = html.match(/@([a-zA-Z0-9_]+)/);

  return {
    success: true,
    medias: [{ url: videoMatch[1], type: 'video' }],
    description: textMatch?.[1]?.trim(),
    author: authorMatch?.[1]
  };
}

async function ssstwitterDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://ssstwitter.com/r', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: `id=${encodeURIComponent(url)}&locale=en`,
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const videoMatches = html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/gi);
  const medias: MediaItem[] = [];

  for (const match of videoMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'video' });
    }
  }

  return { success: medias.length > 0, medias };
}

async function savetwitterDownload(url: string): Promise<DownloadResult> {
  const response = await fetch(`https://savetwitter.net/info?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const videoMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i);

  if (!videoMatch) {
    return { success: false, error: 'SaveTwitter: no se encontró video' };
  }

  return {
    success: true,
    medias: [{ url: videoMatch[1], type: 'video' }]
  };
}

// ============================================================
// 📌 PINTEREST DOWNLOADERS
// ============================================================

export async function downloadPinterest(url: string): Promise<DownloadResult> {
  // API 1: PinTools
  try {
    const result = await pintoolsDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ PinTools falló:', (e as Error).message);
  }

  // API 2: SavePinMedia
  try {
    const result = await savepinmediaDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SavePinMedia falló:', (e as Error).message);
  }

  // API 3: Pinterest directo
  try {
    const result = await pinterestDirectDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ Pinterest directo falló:', (e as Error).message);
  }

  return { success: false, error: 'No se pudo descargar el contenido de Pinterest' };
}

async function pintoolsDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://pintools.app/api/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as {
    success: boolean;
    data?: { url: string; type: string }[];
  };

  if (!data.success || !data.data) {
    return { success: false, error: 'PinTools: respuesta inválida' };
  }

  const medias: MediaItem[] = data.data.map(item => ({
    url: item.url,
    type: item.type === 'video' ? 'video' : 'image'
  }));

  return { success: medias.length > 0, medias };
}

async function savepinmediaDownload(url: string): Promise<DownloadResult> {
  const response = await fetch(`https://savepinmedia.com/download?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();
  const medias: MediaItem[] = [];

  // Buscar videos
  const videoMatches = html.matchAll(/href="(https:\/\/[^"]+\.mp4[^"]*)"/gi);
  for (const match of videoMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'video' });
    }
  }

  // Buscar imágenes
  const imgMatches = html.matchAll(/href="(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/gi);
  for (const match of imgMatches) {
    if (match[1] && !medias.some(m => m.url === match[1])) {
      medias.push({ url: match[1], type: 'image' });
    }
  }

  return { success: medias.length > 0, medias };
}

async function pinterestDirectDownload(url: string): Promise<DownloadResult> {
  // Extraer el ID del pin
  const pinIdMatch = url.match(/pin\/(\d+)/);
  if (!pinIdMatch) {
    return { success: false, error: 'Pinterest: ID no encontrado' };
  }

  // Intentar obtener datos del pin via API no oficial
  const response = await fetch(`https://www.pinterest.com/pin/${pinIdMatch[1]}/`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html'
    },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const html = await response.text();

  // Buscar imagen de alta resolución
  const imgMatch = html.match(/"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/);
  // Buscar video
  const videoMatch = html.match(/"(https:\/\/v\.pinimg\.com\/videos\/[^"]+\.mp4)"/);

  const medias: MediaItem[] = [];
  if (videoMatch) {
    medias.push({ url: videoMatch[1], type: 'video' });
  }
  if (imgMatch) {
    medias.push({ url: imgMatch[1], type: 'image' });
  }

  return { success: medias.length > 0, medias };
}

// ============================================================
// 🧵 THREADS DOWNLOADERS (NUEVO)
// ============================================================

export async function downloadThreads(url: string): Promise<DownloadResult> {
  // API 1: ThreadsDownloader
  try {
    const result = await threadsdownloaderDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ ThreadsDownloader falló:', (e as Error).message);
  }

  // API 2: SaveThreads
  try {
    const result = await savethreadsDownload(url);
    if (result.success) return result;
  } catch (e) {
    console.log('❌ SaveThreads falló:', (e as Error).message);
  }

  return { success: false, error: 'No se pudo descargar el contenido de Threads' };
}

async function threadsdownloaderDownload(url: string): Promise<DownloadResult> {
  const response = await fetch('https://threadsdownloader.com/api/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as {
    success: boolean;
    data?: {
      video_url?: string;
      image_urls?: string[];
      caption?: string;
      username?: string;
    };
  };

  if (!data.success || !data.data) {
    return { success: false, error: 'ThreadsDownloader: respuesta inválida' };
  }

  const medias: MediaItem[] = [];

  if (data.data.video_url) {
    medias.push({ url: data.data.video_url, type: 'video' });
  }

  if (data.data.image_urls) {
    for (const imgUrl of data.data.image_urls) {
      medias.push({ url: imgUrl, type: 'image' });
    }
  }

  return {
    success: medias.length > 0,
    medias,
    description: data.data.caption,
    author: data.data.username
  };
}

async function savethreadsDownload(url: string): Promise<DownloadResult> {
  const response = await fetch(`https://savethreads.net/api?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as {
    status: string;
    video?: string;
    images?: string[];
  };

  if (data.status !== 'ok') {
    return { success: false, error: 'SaveThreads: respuesta inválida' };
  }

  const medias: MediaItem[] = [];

  if (data.video) {
    medias.push({ url: data.video, type: 'video' });
  }

  if (data.images) {
    for (const img of data.images) {
      medias.push({ url: img, type: 'image' });
    }
  }

  return { success: medias.length > 0, medias };
}

// ============================================================
// 🔍 BÚSQUEDA EN PINTEREST
// ============================================================

export async function searchPinterest(query: string): Promise<DownloadResult> {
  // API 1: Pinterest Resource API
  try {
    const result = await pinterestSearchAPI(query);
    if (result.success && result.medias && result.medias.length > 0) return result;
  } catch (e) {
    console.log('❌ Pinterest Search API falló:', (e as Error).message);
  }

  // API 2: BotSailor
  try {
    const result = await botsailorSearch(query);
    if (result.success && result.medias && result.medias.length > 0) return result;
  } catch (e) {
    console.log('❌ BotSailor falló:', (e as Error).message);
  }

  return { success: false, error: 'No se encontraron imágenes en Pinterest' };
}

async function pinterestSearchAPI(query: string): Promise<DownloadResult> {
  const searchUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${encodeURIComponent(query)}&data={"options":{"query":"${query}","scope":"pins"},"context":{}}`;

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as {
    resource_response?: {
      data?: {
        results?: Array<{
          images?: {
            orig?: { url?: string };
            '736x'?: { url?: string };
          };
        }>;
      };
    };
  };

  const results = data.resource_response?.data?.results;
  if (!results || results.length === 0) {
    return { success: false, error: 'Pinterest: sin resultados' };
  }

  const medias: MediaItem[] = [];
  for (const pin of results) {
    const imgUrl = pin.images?.orig?.url || pin.images?.['736x']?.url;
    if (imgUrl && !medias.some(m => m.url === imgUrl)) {
      medias.push({ url: imgUrl, type: 'image' });
    }
    if (medias.length >= 5) break;
  }

  return { success: medias.length > 0, medias };
}

async function botsailorSearch(query: string): Promise<DownloadResult> {
  const response = await fetch(`https://api.botsailor.com/tools/pinterest?query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  const data = await response.json() as { status?: boolean; data?: string[] };

  if (!data.status || !data.data) {
    return { success: false, error: 'BotSailor: respuesta inválida' };
  }

  const medias: MediaItem[] = data.data.slice(0, 5).map(url => ({
    url,
    type: 'image' as const
  }));

  return { success: medias.length > 0, medias };
}

// ============================================================
// 🌐 COBALT API (ALL-IN-ONE UNIVERSAL)
// ============================================================

export interface CobaltOptions {
  videoQuality?: '144' | '240' | '360' | '480' | '720' | '1080' | '1440' | '2160' | '4320' | 'max';
  audioFormat?: 'best' | 'mp3' | 'ogg' | 'wav' | 'opus';
  downloadMode?: 'auto' | 'audio' | 'mute';
}

export async function downloadWithCobalt(url: string, options: CobaltOptions = {}): Promise<DownloadResult> {
  const instances = [
    'https://api.cobalt.tools',
    'https://cobalt-api.hyper.lol',
    'https://cobalt.api.timelessnesses.me'
  ];

  for (const instance of instances) {
    try {
      const response = await fetch(instance, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({
          url,
          videoQuality: options.videoQuality || '720',
          audioFormat: options.audioFormat || 'mp3',
          downloadMode: options.downloadMode || 'auto'
        }),
        signal: AbortSignal.timeout(TIMEOUT)
      });

      const data = await response.json() as {
        status: string;
        url?: string;
        picker?: Array<{ url: string; type: string }>;
        error?: { code: string };
      };

      if (data.status === 'error') {
        continue;
      }

      const medias: MediaItem[] = [];

      if (data.status === 'tunnel' || data.status === 'redirect') {
        if (data.url) {
          medias.push({
            url: data.url,
            type: options.downloadMode === 'audio' ? 'audio' : 'video'
          });
        }
      } else if (data.status === 'picker' && data.picker) {
        for (const item of data.picker) {
          medias.push({
            url: item.url,
            type: item.type === 'video' ? 'video' : 'image'
          });
        }
      }

      if (medias.length > 0) {
        return { success: true, medias };
      }
    } catch (e) {
      console.log(`❌ Cobalt (${instance}) falló:`, (e as Error).message);
      continue;
    }
  }

  return { success: false, error: 'Cobalt: todas las instancias fallaron' };
}

// ============================================================
// 🎯 AUTO-DETECTOR UNIVERSAL
// ============================================================

export type Platform = 'tiktok' | 'instagram' | 'facebook' | 'twitter' | 'pinterest' | 'threads' | 'youtube' | 'unknown';

export function detectPlatform(url: string): Platform {
  if (/(?:tiktok\.com|vm\.tiktok\.com)/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/(?:facebook\.com|fb\.watch)/i.test(url)) return 'facebook';
  if (/(?:twitter\.com|x\.com)/i.test(url)) return 'twitter';
  if (/(?:pinterest\.com|pin\.it)/i.test(url)) return 'pinterest';
  if (/threads\.net/i.test(url)) return 'threads';
  if (/(?:youtube\.com|youtu\.be)/i.test(url)) return 'youtube';
  return 'unknown';
}

export async function downloadAuto(url: string, audioOnly = false): Promise<DownloadResult & { platform: Platform }> {
  const platform = detectPlatform(url);

  // 🚀 PRIMERA OPCIÓN: API local dev3-downloader (más rápida y confiable)
  // Soporta: YouTube, TikTok, Instagram, Twitter, Facebook
  if (['youtube', 'tiktok', 'instagram', 'twitter', 'facebook'].includes(platform)) {
    try {
      const dev3Result = await downloadWithDev3Api(url, audioOnly);
      if (dev3Result.success) {
        console.log(`✅ dev3-downloader: descarga exitosa (${platform})`);
        return { ...dev3Result, platform };
      }
    } catch (e) {
      console.log('⚠️ dev3-downloader no disponible, usando fallback...');
    }
  }

  // FALLBACK: APIs públicas específicas por plataforma
  let result: DownloadResult;

  switch (platform) {
    case 'tiktok':
      result = await downloadTikTok(url);
      break;
    case 'instagram':
      result = await downloadInstagram(url);
      break;
    case 'facebook':
      result = await downloadFacebook(url);
      break;
    case 'twitter':
      result = await downloadTwitter(url);
      break;
    case 'pinterest':
      result = await downloadPinterest(url);
      break;
    case 'threads':
      result = await downloadThreads(url);
      break;
    case 'youtube':
      // YouTube: intentar con Cobalt público como fallback
      result = await downloadWithCobalt(url);
      break;
    default:
      // Intentar primero con API local para URLs desconocidas
      try {
        const dev3Result = await downloadWithDev3Api(url, audioOnly);
        if (dev3Result.success) {
          return { ...dev3Result, platform };
        }
      } catch {
        // Continuar con Cobalt público
      }
      result = await downloadWithCobalt(url);
  }

  // Si falla, intentar con Cobalt como último recurso
  if (!result.success && platform !== 'youtube' && platform !== 'unknown') {
    const cobaltResult = await downloadWithCobalt(url);
    if (cobaltResult.success) {
      return { ...cobaltResult, platform };
    }
  }

  return { ...result, platform };
}
