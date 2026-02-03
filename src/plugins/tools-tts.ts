/**
 * 🔊 Plugin Text-to-Speech (TTS) - CYALTRONIC
 * Convierte texto a voz usando Google Translate TTS
 * Comando: /tts [idioma] <texto>
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

const LANGUAGES: Record<string, string> = {
  es: 'Español', en: 'English', pt: 'Português', fr: 'Français',
  de: 'Deutsch', it: 'Italiano', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi'
};

/**
 * Sanitiza texto para TTS (evita errores con ciertos caracteres/patrones)
 */
function sanitizeTextForTTS(text: string): string {
  // Agregar un espacio al inicio si empieza con ciertos caracteres problemáticos
  // Google TTS tiene problemas con textos que empiezan con L, I, etc. solos
  let sanitized = text.trim();

  // Si el texto es muy corto (1-2 caracteres), agregar contexto
  if (sanitized.length <= 2) {
    sanitized = `Dice: ${sanitized}`;
  }

  // Reemplazar caracteres que pueden causar problemas de encoding
  sanitized = sanitized
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width characters
    .replace(/\s+/g, ' '); // Múltiples espacios a uno

  return sanitized;
}

/**
 * Descarga audio TTS de Google Translate con fallback
 */
async function getTTSAudio(text: string, lang: string): Promise<Buffer> {
  // Sanitizar texto
  const sanitizedText = sanitizeTextForTTS(text);

  // Google TTS tiene límite de ~200 caracteres, dividir si es necesario
  const maxLen = 200;
  const chunks: string[] = [];

  if (sanitizedText.length <= maxLen) {
    chunks.push(sanitizedText);
  } else {
    // Dividir por oraciones o espacios
    let remaining = sanitizedText;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Buscar punto o espacio antes del límite
      let cutIndex = remaining.lastIndexOf('.', maxLen);
      if (cutIndex === -1 || cutIndex < 50) {
        cutIndex = remaining.lastIndexOf(' ', maxLen);
      }
      if (cutIndex === -1 || cutIndex < 50) {
        cutIndex = maxLen;
      }
      chunks.push(remaining.substring(0, cutIndex + 1).trim());
      remaining = remaining.substring(cutIndex + 1).trim();
    }
  }

  const audioBuffers: Buffer[] = [];

  // Lista de clientes TTS de Google para fallback
  const clients = ['tw-ob', 'gtx'];

  for (const chunk of chunks) {
    let lastError: Error | null = null;
    let buffer: Buffer | null = null;

    for (const client of clients) {
      try {
        const encodedChunk = encodeURIComponent(chunk);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=${client}&q=${encodedChunk}`;

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://translate.google.com/',
            'Accept': 'audio/mpeg, audio/*;q=0.9, */*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
          }
        });

        if (response.ok) {
          buffer = Buffer.from(await response.arrayBuffer());
          break; // Éxito, salir del loop de clientes
        }

        lastError = new Error(`HTTP ${response.status} con cliente ${client}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Pequeño delay antes de intentar con otro cliente
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!buffer) {
      throw new Error(`Error al obtener audio TTS: ${lastError?.message || 'Unknown error'}`);
    }

    audioBuffers.push(buffer);

    // Delay entre chunks para evitar rate limiting
    if (chunks.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Si solo hay un chunk, retornar directamente
  if (audioBuffers.length === 1) {
    return audioBuffers[0];
  }

  // Concatenar buffers
  return Buffer.concat(audioBuffers);
}

/**
 * Comando /tts - Text to Speech
 */
export const ttsPlugin: PluginHandler = {
  command: ['tts', 'voz', 'speak'],
  description: 'Convertir texto a voz',
  category: 'tools',

  async handler(ctx: MessageContext) {
    const { m, text, args, conn } = ctx;

    if (!text && !m.quoted?.text) {
      let langList = '🔊 *TEXT TO SPEECH*\n\n📝 Uso:\n• /tts <texto> - Voz en español\n• /tts en <texto> - Voz en inglés\n• /tts (responder a msg) - Convertir mensaje\n\n🌐 Idiomas:\n';
      for (const [code, name] of Object.entries(LANGUAGES)) {
        langList += `• *${code}* - ${name}\n`;
      }
      await m.reply(langList);
      return;
    }

    // Determinar idioma y texto
    let lang = 'es';
    let ttsText = text;

    if (args.length >= 2 && args[0].length === 2 && args[0].toLowerCase() in LANGUAGES) {
      lang = args[0].toLowerCase();
      ttsText = args.slice(1).join(' ');
    } else if (args.length >= 2 && args[0].length === 2) {
      // Idioma no reconocido pero formato correcto, intentar de todos modos
      lang = args[0].toLowerCase();
      ttsText = args.slice(1).join(' ');
    }

    // Si no hay texto, usar el mensaje citado
    if (!ttsText && m.quoted?.text) {
      ttsText = m.quoted.text;
    }

    if (!ttsText) {
      await m.reply('❌ Escribe el texto que quieres convertir a voz.\n\n📝 Uso: /tts <texto>');
      return;
    }

    // Límite de caracteres
    if (ttsText.length > 1000) {
      await m.reply('⚠️ El texto es muy largo. Máximo 1000 caracteres.');
      return;
    }

    await m.react('🔊');

    try {
      const audioBuffer = await getTTSAudio(ttsText, lang);

      await conn.sendMessage(m.chat, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: true
      }, { quoted: m.rawMessage });

      await m.react('✅');
    } catch (error) {
      console.error('❌ Error en TTS:', error);
      await m.react('❌');
      await m.reply('❌ Error al generar el audio. Intenta de nuevo.');
    }
  }
};
