import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';
import { normalizeText } from '../lib/utils.js';

const log = createLogger('tools');
const TIMEOUT_MS = 10_000;
const MAX_CHARS = 2000;

interface Language {
  code: string;
  /** Nombre en español para mostrar */
  label: string;
  /** Formas aceptadas al escribir el idioma (sin acentos, minúsculas) */
  names: string[];
}

export const LANGUAGES: Language[] = [
  { code: 'es', label: 'español', names: ['espanol', 'spanish', 'esp'] },
  { code: 'en', label: 'inglés', names: ['ingles', 'english', 'ing'] },
  { code: 'pt', label: 'portugués', names: ['portugues', 'portuguese', 'br'] },
  { code: 'fr', label: 'francés', names: ['frances', 'french'] },
  { code: 'de', label: 'alemán', names: ['aleman', 'german'] },
  { code: 'it', label: 'italiano', names: ['italiano', 'italian'] },
  { code: 'ja', label: 'japonés', names: ['japones', 'japanese', 'jp'] },
  { code: 'ko', label: 'coreano', names: ['coreano', 'korean', 'kr'] },
  { code: 'zh-CN', label: 'chino', names: ['chino', 'chinese', 'zh', 'cn'] },
  { code: 'ru', label: 'ruso', names: ['ruso', 'russian'] },
  { code: 'ar', label: 'árabe', names: ['arabe', 'arabic'] },
  { code: 'hi', label: 'hindi', names: ['hindi'] },
  { code: 'tr', label: 'turco', names: ['turco', 'turkish'] },
  { code: 'nl', label: 'neerlandés', names: ['holandes', 'neerlandes', 'dutch'] },
  { code: 'pl', label: 'polaco', names: ['polaco', 'polish'] },
  { code: 'ca', label: 'catalán', names: ['catalan'] },
  { code: 'la', label: 'latín', names: ['latin'] },
];

export function findLanguage(input: string): Language | null {
  const key = normalizeText(input.trim());
  if (!key) return null;
  return LANGUAGES.find((l) => l.code.toLowerCase() === key || l.code.toLowerCase().split('-')[0] === key || l.names.includes(key)) ?? null;
}

function labelFor(code: string): string {
  return findLanguage(code)?.label ?? code;
}

/** Respuesta de translate_a/single con dt=t&dj=1: sentences con trans y el idioma detectado. */
interface GoogleTranslateResponse {
  sentences?: { trans?: string }[];
  src?: string;
}

export interface TranslationResult {
  ok: boolean;
  translation?: string;
  detected?: string;
  error?: string;
}

export async function translateText(text: string, targetCode: string, sourceCode = 'auto'): Promise<TranslationResult> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceCode)}&tl=${encodeURIComponent(targetCode)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `El traductor respondió ${response.status}.` };
    if (!(response.headers.get('content-type') ?? '').includes('json')) return { ok: false, error: 'El traductor devolvió algo inesperado.' };
    const data = (await response.json()) as GoogleTranslateResponse;
    const translation = (data.sentences ?? []).map((s) => s.trans ?? '').join('').trim();
    if (!translation) return { ok: false, error: 'No obtuve traducción.' };
    return { ok: true, translation, detected: data.src || sourceCode };
  } catch (error) {
    log.warn('traductor:', error instanceof Error ? error.message : error);
    return { ok: false, error: 'No pude conectar con el traductor.' };
  }
}

export const translatePlugin: PluginHandler = {
  command: ['translate', 'traducir', 'tr'],
  description: 'Traduce texto a otro idioma',
  category: 'herramientas',
  help: [
    'translate [idioma] <texto> - Traduce (por defecto al español); también citando un mensaje',
    'translate idiomas - Lista los idiomas disponibles',
  ],
  usage: ['translate en Hola mundo', 'translate japonés Buenos días', 'translate (citando un mensaje)'],

  handler: async ({ m, args, usedPrefix }) => {
    if (args.length === 1 && /^(idiomas|langs?|languages)$/i.test(args[0])) {
      return m.reply(`🌐 *Idiomas*\n${LANGUAGES.map((l) => `• ${l.code} (${l.label})`).join('\n')}`);
    }

    const quoted = m.quoted?.text?.trim() || '';
    let target = findLanguage('es')!;
    let text = '';

    const firstAsLang = args.length > 0 ? findLanguage(args[0]) : null;
    if (args.length === 0) {
      text = quoted;
    } else if (firstAsLang && args.length === 1) {
      target = firstAsLang;
      text = quoted;
      if (!text) {
        return m.reply(`¿Qué traduzco al ${target.label}? Escribe *${usedPrefix}translate ${args[0]} <texto>* o cita un mensaje.`);
      }
    } else if (firstAsLang) {
      target = firstAsLang;
      text = args.slice(1).join(' ');
    } else {
      text = args.join(' ');
    }

    if (!text) {
      return m.reply(
        `🌐 *${usedPrefix}translate [idioma] <texto>* o cita un mensaje.\n` +
        `Ejemplos: *${usedPrefix}translate en Hola mundo*, *${usedPrefix}translate japonés Buenos días*\n` +
        `Idiomas: *${usedPrefix}translate idiomas*`,
      );
    }
    if (text.length > MAX_CHARS) return m.reply(`Demasiado largo: máximo ${MAX_CHARS} caracteres.`);

    await m.react('⏳');
    const result = await translateText(text, target.code);
    if (!result.ok || !result.translation) {
      await m.react('❌');
      return m.reply(`❌ ${result.error ?? 'No pude traducir el texto.'}`);
    }
    await m.react('✅');
    await m.reply(`🌐 *${labelFor(result.detected ?? 'auto')} → ${target.label}*\n\n${result.translation}`);
  },
};
