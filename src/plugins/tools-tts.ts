import type { MessageContext, PluginHandler } from '../types/message.js';
import { BROWSER_USER_AGENT, fetchWithTimeout } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getQuotedText } from '../lib/media.js';

const log = createLogger('media');

export const LANGUAGES: Record<string, string> = {
  es: 'Español', en: 'English', pt: 'Português', fr: 'Français',
  de: 'Deutsch', it: 'Italiano', ja: '日本語', ko: '한국어',
  zh: '中文', ru: 'Русский', ar: 'العربية', hi: 'हिन्दी',
};

export const DEFAULT_LANG = 'es';
export const MAX_TEXT_LENGTH = 1000;
/** Google TTS corta las peticiones largas; se trocea por frases. */
const CHUNK_LENGTH = 200;
const REQUEST_TIMEOUT_MS = 15_000;

export interface TtsInput {
  lang: string;
  text: string;
}

/**
 * Idioma solo cuando se pide explícitamente: "en: texto" o "-en texto" con un
 * código de LANGUAGES. Cualquier otra cosa es texto en español, así "la casa"
 * no se lee en latín. El código solo ("en:" respondiendo a un mensaje) deja el
 * texto vacío para que el llamador use el citado en ese idioma.
 */
export function parseTtsInput(raw: string): TtsInput {
  const text = raw.trim();
  const match = text.match(/^(?:-([a-z]{2})(?:\s+|$)|([a-z]{2}):\s*)([\s\S]*)$/i);
  if (match) {
    const code = (match[1] ?? match[2]).toLowerCase();
    if (code in LANGUAGES) return { lang: code, text: match[3].trim() };
  }
  return { lang: DEFAULT_LANG, text };
}

function sanitize(text: string): string {
  const clean = text.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  // Con una o dos letras sueltas Google devuelve audio vacío; se les da contexto.
  return clean.length <= 2 ? `Dice: ${clean}` : clean;
}

/** Trocea en fragmentos de hasta 200 caracteres cortando por frase o espacio. */
export function splitTtsChunks(text: string, maxLen = CHUNK_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = sanitize(text);
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('.', maxLen);
    if (cut < maxLen / 4) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < maxLen / 4) cut = maxLen - 1;
    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

const CLIENTS = ['tw-ob', 'gtx'];

async function fetchChunk(chunk: string, lang: string): Promise<Buffer> {
  let lastError = 'sin respuesta';
  for (const client of CLIENTS) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=${client}&q=${encodeURIComponent(chunk)}`;
    try {
      const response = await fetchWithTimeout(url, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Referer: 'https://translate.google.com/',
          Accept: 'audio/mpeg, audio/*;q=0.9, */*;q=0.8',
        },
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = `HTTP ${response.status} (${client})`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Google TTS falló: ${lastError}`);
}

export async function getTtsAudio(text: string, lang: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const chunk of splitTtsChunks(text)) {
    parts.push(await fetchChunk(chunk, lang));
  }
  return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}

function languageList(): string {
  return Object.entries(LANGUAGES).map(([code, name]) => `• *${code}* - ${name}`).join('\n');
}

export const ttsPlugin: PluginHandler = {
  command: ['tts', 'voz', 'speak'],
  description: 'Convertir texto a voz',
  category: 'tools',
  usage: ['tts <texto>', 'tts en: <texto>', 'tts -pt <texto>', 'tts idiomas'],

  async handler(ctx: MessageContext) {
    const { m, text, send } = ctx;
    const trimmed = text.trim();

    if (/^idiomas?$|^langs?$/i.test(trimmed)) {
      await m.reply(`🌐 *IDIOMAS DE /tts*\n\n${languageList()}\n\nUso: /tts en: hello o /tts -en hello`);
      return;
    }

    const parsed = parseTtsInput(trimmed);
    // Sin texto propio se lee el mensaje citado (incluido el caption de un video) en el idioma pedido.
    if (!parsed.text) parsed.text = getQuotedText(m).trim();
    if (!parsed.text) {
      await m.reply('🔊 *TEXT TO SPEECH*\n\n📝 Uso:\n• /tts <texto> → voz en español\n• /tts en: <texto> o /tts -en <texto> → otro idioma\n• /tts (respondiendo a un mensaje)\n• /tts idiomas → lista de idiomas');
      return;
    }
    if (parsed.text.length > MAX_TEXT_LENGTH) {
      await m.reply(`⚠️ El texto es muy largo (${parsed.text.length} caracteres). Máximo ${MAX_TEXT_LENGTH}.`);
      return;
    }

    await m.react('🔊');
    try {
      const audio = await getTtsAudio(parsed.text, parsed.lang);
      await send({ audio, mimetype: 'audio/mpeg', ptt: true }, { quoted: m.rawMessage });
      await m.react('✅');
    } catch (error) {
      log.warn('tts:', error instanceof Error ? error.message : error);
      await m.react('❌');
      await m.reply('❌ No se pudo generar el audio. Intenta de nuevo en un momento.');
    }
  },
};
