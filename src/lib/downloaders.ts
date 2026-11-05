import {
  downloadMedia,
  describeFailure,
  type DownloadErrorCode,
  type DownloadOptions,
  type RemoteMediaType,
} from './downloader-client.js';

export type Platform = 'tiktok' | 'instagram' | 'facebook' | 'twitter' | 'pinterest' | 'threads' | 'youtube' | 'unknown';

export interface MediaItem {
  url: string;
  type: RemoteMediaType;
  /** Bytes declarados por el servicio (0 si no se conocen). */
  size: number;
  filename?: string;
}

export interface DownloadResult {
  success: boolean;
  medias?: MediaItem[];
  title?: string;
  author?: string;
  duration?: number | null;
  thumbnail?: string | null;
  /** Texto para el usuario cuando success es false. */
  error?: string;
  code?: DownloadErrorCode;
}

export const PLATFORMS: Record<Platform, { name: string; emoji: string }> = {
  tiktok: { name: 'TikTok', emoji: '📱' },
  instagram: { name: 'Instagram', emoji: '📸' },
  facebook: { name: 'Facebook', emoji: '📘' },
  twitter: { name: 'Twitter/X', emoji: '🐦' },
  pinterest: { name: 'Pinterest', emoji: '📌' },
  threads: { name: 'Threads', emoji: '🧵' },
  youtube: { name: 'YouTube', emoji: '📺' },
  unknown: { name: 'Enlace', emoji: '🌐' },
};

export function platformLabel(platform: Platform): string {
  const { emoji, name } = PLATFORMS[platform];
  return `${emoji} ${name}`;
}

/** pinterest.com, pinterest.es, pinterest.co.uk, pinterest.com.mx...; no "pinterest.evil.com". */
const PINTEREST_HOST = /(^|\.)(pinterest\.(com|[a-z]{2}|com?\.[a-z]{2})|pin\.it)$/;

const HOST_RULES: [Platform, RegExp][] = [
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
  ['twitter', /(^|\.)(twitter\.com|x\.com)$/],
  ['pinterest', PINTEREST_HOST],
  ['threads', /(^|\.)threads\.(net|com)$/],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
];

/** Antepone https:// cuando el enlace viene sin esquema ("vm.tiktok.com/x"). */
export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Plataforma por el host de la URL (no por subcadenas, para que ?u=x.com no engañe). */
export function detectPlatform(url: string): Platform {
  let host: string;
  try {
    host = new URL(normalizeUrl(url)).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  for (const [platform, rule] of HOST_RULES) {
    if (rule.test(host)) return platform;
  }
  return 'unknown';
}

/**
 * Cualquier URL con esquema o, sin él, un enlace a una plataforma conocida
 * ("youtube.com/watch?v=x", "vm.tiktok.com/x"), como aceptaban los comandos antiguos.
 */
export const URL_REGEX =
  /https?:\/\/[^\s<>"']+|(?<![\w.@/-])(?:[\w-]+\.)*(?:tiktok\.com|instagram\.com|instagr\.am|facebook\.com|fb\.watch|fb\.com|twitter\.com|x\.com|pinterest\.(?:com|[a-z]{2}|com?\.[a-z]{2})|pin\.it|threads\.(?:net|com)|youtube\.com|youtu\.be)\/[^\s<>"']+/i;

/**
 * Primera URL que casa con `regex` en el texto o, si no hay, en el texto citado,
 * siempre con esquema. Recorta la puntuación final que suele pegarse al enlace.
 */
export function extractUrl(text: string | undefined, quotedText?: string, regex: RegExp = URL_REGEX): string | null {
  for (const source of [text, quotedText]) {
    if (!source) continue;
    const match = source.match(regex);
    if (match) return normalizeUrl(match[0].replace(/[.,;:!?)\]]+$/, ''));
  }
  return null;
}

/** Descarga por el servicio propio, una sola llamada para cualquier plataforma (incluida 'unknown'). */
export async function downloadAuto(rawUrl: string, options: DownloadOptions = {}): Promise<DownloadResult & { platform: Platform }> {
  const url = normalizeUrl(rawUrl);
  const platform = detectPlatform(url);
  const result = await downloadMedia(url, options);
  if (!result.success) {
    return { success: false, platform, code: result.code, error: describeFailure(result) };
  }
  const { data } = result;
  return {
    success: true,
    platform,
    medias: data.medias.map((m) => ({ url: m.url, type: m.type, size: m.size, filename: m.filename })),
    title: data.title ?? undefined,
    author: data.author ?? undefined,
    duration: data.duration,
    thumbnail: data.thumbnail,
  };
}
