import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('tools');

const WIKI_API = 'https://es.wikipedia.org/w/api.php';
const WIKI_SUMMARY = 'https://es.wikipedia.org/api/rest_v1/page/summary/';
const TIMEOUT_MS = 10_000;
const EXTRACT_MAX = 600;
/** Solo se descargan miniaturas del CDN de Wikimedia, de tipo imagen y hasta este tamaño. */
const THUMBNAIL_HOST = 'upload.wikimedia.org';
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'cyalbot/3.1 (bot de WhatsApp; https://github.com/cyal-dev3/cyalbot)';

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  thumbnail?: string;
  disambiguation: boolean;
}

type OpenSearchResponse = [string, string[], string[], string[]];

interface SummaryResponse {
  type?: string;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;
  if (!(response.headers.get('content-type') ?? '').includes('json')) return null;
  return (await response.json()) as T;
}

function trimExtract(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= EXTRACT_MAX) return clean;
  const cut = clean.slice(0, EXTRACT_MAX);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, end > EXTRACT_MAX / 2 ? end : EXTRACT_MAX).trim()}…`;
}

/** Busca el artículo más cercano a la consulta y devuelve su resumen, o null si no hay nada. */
export async function getWikiSummary(query: string): Promise<WikiSummary | null> {
  const q = query.trim();
  if (!q) return null;
  const search = await getJson<OpenSearchResponse>(`${WIKI_API}?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`);
  const title = search?.[1]?.[0];
  if (!title) return null;

  const summary = await getJson<SummaryResponse>(`${WIKI_SUMMARY}${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!summary?.title) return null;
  return {
    title: summary.title,
    extract: trimExtract(summary.extract || ''),
    url: summary.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    thumbnail: summary.thumbnail?.source,
    disambiguation: summary.type === 'disambiguation',
  };
}

/** true solo para https://upload.wikimedia.org/...: la API no debería devolver otra cosa, y si lo hace no se sigue. */
export function isAllowedThumbnail(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === THUMBNAIL_HOST;
  } catch {
    return false;
  }
}

async function fetchThumbnail(url: string): Promise<Buffer | null> {
  if (!isAllowedThumbnail(url)) {
    log.warn('miniatura fuera de upload.wikimedia.org ignorada:', url.slice(0, 120));
    return null;
  }
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok || !response.body) return null;
    if (!(response.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > THUMBNAIL_MAX_BYTES) return null;
    return await readUpTo(response.body, THUMBNAIL_MAX_BYTES);
  } catch (error) {
    log.debug('miniatura no descargada:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Lee el cuerpo hasta `limit` bytes; si lo supera, corta la descarga y devuelve null. */
async function readUpTo(body: ReadableStream<Uint8Array>, limit: number): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const wikiPlugin: PluginHandler = {
  command: ['wiki', 'wikipedia'],
  description: 'Resumen de Wikipedia en español',
  category: 'herramientas',
  help: ['wiki <tema> - Resumen del artículo de Wikipedia con su enlace'],
  usage: ['wiki agujero negro'],

  handler: async ({ m, text, usedPrefix, send }) => {
    const query = text.trim() || m.quoted?.text?.trim() || '';
    if (!query) {
      await m.reply(`Escribe qué buscar: *${usedPrefix}wiki Benito Juárez*`);
      return;
    }
    await m.react('⏳');
    let result: WikiSummary | null;
    try {
      result = await getWikiSummary(query);
    } catch (error) {
      log.warn('wikipedia no respondió:', error instanceof Error ? error.message : error);
      await m.react('❌');
      await m.reply('Wikipedia no respondió a tiempo. Intenta de nuevo en un momento.');
      return;
    }
    if (!result) {
      await m.react('❌');
      await m.reply(`No encontré nada en Wikipedia sobre "${query}".`);
      return;
    }
    const body = result.disambiguation
      ? `*${result.title}* tiene varios significados. Sé más específico o revisa:\n${result.url}`
      : `📖 *${result.title}*\n\n${result.extract || '_Sin resumen disponible._'}\n\n${result.url}`;
    const image = result.thumbnail && !result.disambiguation ? await fetchThumbnail(result.thumbnail) : null;
    await m.react('✅');
    if (image) await send({ image, caption: body }, { quoted: m.rawMessage });
    else await m.reply(body);
  },
};
