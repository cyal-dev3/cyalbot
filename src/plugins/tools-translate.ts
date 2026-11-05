/**
 * Plugin de Traducción
 * Comando: /translate
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

// Códigos de idiomas comunes
const LANGUAGE_CODES: Record<string, string> = {
  // Español
  'es': 'es', 'español': 'es', 'spanish': 'es',
  // Inglés
  'en': 'en', 'ingles': 'en', 'english': 'en', 'ing': 'en',
  // Portugués
  'pt': 'pt', 'portugues': 'pt', 'portuguese': 'pt',
  // Francés
  'fr': 'fr', 'frances': 'fr', 'french': 'fr',
  // Alemán
  'de': 'de', 'aleman': 'de', 'german': 'de',
  // Italiano
  'it': 'it', 'italiano': 'it', 'italian': 'it',
  // Japonés
  'ja': 'ja', 'japones': 'ja', 'japanese': 'ja', 'jp': 'ja',
  // Coreano
  'ko': 'ko', 'coreano': 'ko', 'korean': 'ko', 'kr': 'ko',
  // Chino
  'zh': 'zh', 'chino': 'zh', 'chinese': 'zh', 'cn': 'zh',
  // Ruso
  'ru': 'ru', 'ruso': 'ru', 'russian': 'ru',
  // Árabe
  'ar': 'ar', 'arabe': 'ar', 'arabic': 'ar',
  // Hindi
  'hi': 'hi', 'hindi': 'hi',
  // Turco
  'tr': 'tr', 'turco': 'tr', 'turkish': 'tr',
  // Holandés
  'nl': 'nl', 'holandes': 'nl', 'dutch': 'nl',
  // Polaco
  'pl': 'pl', 'polaco': 'pl', 'polish': 'pl',
};

/**
 * Traduce texto usando Google Translate API
 */
async function translateText(text: string, targetLang: string, sourceLang: string = 'auto'): Promise<{
  success: boolean;
  translation?: string;
  detectedLang?: string;
  error?: string;
}> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const data = await response.json() as [[[string, string]], unknown, string];

    if (!data || !data[0]) {
      return { success: false, error: 'No se pudo traducir el texto' };
    }

    // Construir traducción desde las partes
    let translation = '';
    for (const part of data[0]) {
      if (part[0]) translation += part[0];
    }

    return {
      success: true,
      translation,
      detectedLang: data[2] || sourceLang
    };
  } catch (error) {
    console.error('Error en traducción:', error);
    return { success: false, error: 'Error al conectar con el traductor' };
  }
}

/**
 * Comando /translate - Traducir texto
 */
export const translatePlugin: PluginHandler = {
  command: ['translate', 'traducir', 'tr'],
  description: 'Traducir texto a otro idioma',
  category: 'tools',

  async handler(ctx: MessageContext) {
    const { m, text, args } = ctx;

    // Obtener texto del mensaje citado si existe
    let textToTranslate = '';
    let targetLang = 'es'; // Por defecto español

    if (args.length === 0 && m.quoted?.text) {
      // Si no hay argumentos pero hay mensaje citado
      textToTranslate = m.quoted.text;
    } else if (args.length === 1 && m.quoted?.text) {
      // Si hay un argumento (idioma) y mensaje citado
      targetLang = LANGUAGE_CODES[args[0].toLowerCase()] || args[0].toLowerCase();
      textToTranslate = m.quoted.text;
    } else if (args.length >= 2) {
      // Primer argumento es el idioma, el resto es el texto
      targetLang = LANGUAGE_CODES[args[0].toLowerCase()] || args[0].toLowerCase();
      textToTranslate = args.slice(1).join(' ');
    } else if (args.length === 1) {
      // Solo texto, traducir a español
      textToTranslate = args[0];
    }

    if (!textToTranslate) {
      const langList = '• es (español)\n• en (inglés)\n• pt (portugués)\n• fr (francés)\n• de (alemán)\n• it (italiano)\n• ja (japonés)\n• ko (coreano)\n• zh (chino)\n• ru (ruso)';

      await m.reply(
        `🌐 *TRADUCTOR*\n\n` +
        `📝 Uso:\n` +
        `• /translate <idioma> <texto>\n` +
        `• /translate <idioma> (citando mensaje)\n\n` +
        `🌍 Idiomas disponibles:\n${langList}\n\n` +
        `📌 Ejemplo:\n` +
        `/translate en Hola mundo\n` +
        `/translate japones Buenos días`
      );
      return;
    }

    await m.react('⏳');

    const result = await translateText(textToTranslate, targetLang);

    if (!result.success || !result.translation) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo traducir el texto'}`);
      return;
    }

    await m.react('✅');

    const langName = Object.entries(LANGUAGE_CODES).find(([_, code]) => code === result.detectedLang)?.[0] || result.detectedLang;

    await m.reply(
      `🌐 *TRADUCCIÓN*\n\n` +
      `📤 Idioma detectado: ${langName}\n` +
      `📥 Idioma destino: ${targetLang}\n\n` +
      `📝 Original:\n${textToTranslate}\n\n` +
      `✨ Traducción:\n${result.translation}`
    );
  }
};
