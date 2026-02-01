/**
 * 🌐 Plugin Universal de Descarga
 * Comando: /dl, /download
 * Detecta automáticamente la plataforma y descarga
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { downloadAuto, detectPlatform, downloadWithCobalt, type Platform } from '../lib/downloaders.js';

const URL_REGEX = /https?:\/\/[^\s]+/i;

const PLATFORM_EMOJI: Record<Platform, string> = {
  tiktok: '📱',
  instagram: '📸',
  facebook: '📘',
  twitter: '🐦',
  pinterest: '📌',
  threads: '🧵',
  youtube: '📺',
  unknown: '🌐'
};

const PLATFORM_NAME: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter/X',
  pinterest: 'Pinterest',
  threads: 'Threads',
  youtube: 'YouTube',
  unknown: 'Desconocido'
};

/**
 * Comando /dl - Descarga universal automática
 */
export const universalDownloadPlugin: PluginHandler = {
  command: ['dl', 'download', 'descargar', 'bajar'],
  description: 'Descarga automática de cualquier red social',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener URL del texto o del mensaje citado
    let url = text.trim();

    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(URL_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('🌐 *DESCARGADOR UNIVERSAL*\n\n📝 Uso: /dl <url>\n\n📌 Plataformas soportadas:\n• TikTok\n• Instagram\n• Facebook\n• Twitter/X\n• Pinterest\n• Threads\n• YouTube\n• Y más...\n\n💡 Detecta automáticamente la plataforma!');
      return;
    }

    // Validar que sea una URL
    if (!URL_REGEX.test(url)) {
      await m.reply('❌ Proporciona una URL válida.');
      return;
    }

    const platform = detectPlatform(url);
    const emoji = PLATFORM_EMOJI[platform];
    const name = PLATFORM_NAME[platform];

    await m.react('⏳');
    await m.reply(`${emoji} Descargando de *${name}*...`);

    const result = await downloadAuto(url);

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el contenido'}`);
      return;
    }

    try {
      const platformEmoji = PLATFORM_EMOJI[result.platform];
      const platformName = PLATFORM_NAME[result.platform];

      let caption = `${platformEmoji} *${platformName} Download*\n\n`;
      if (result.author) caption += `👤 ${result.author}\n`;
      if (result.title) caption += `📝 ${result.title}\n`;
      if (result.description) {
        const desc = result.description.substring(0, 150);
        caption += `💬 ${desc}${result.description.length > 150 ? '...' : ''}`;
      }
      caption += `\n📦 ${result.medias.length} archivo(s)`;

      // Enviar cada media
      for (let i = 0; i < result.medias.length && i < 10; i++) {
        const media = result.medias[i];
        const response = await fetch(media.url);
        const buffer = Buffer.from(await response.arrayBuffer());

        if (media.type === 'video') {
          await conn.sendMessage(m.chat, {
            video: buffer,
            caption: i === 0 ? caption : undefined,
            mimetype: 'video/mp4'
          }, { quoted: m.rawMessage });
        } else if (media.type === 'audio') {
          await conn.sendMessage(m.chat, {
            audio: buffer,
            caption: i === 0 ? caption : undefined,
            mimetype: 'audio/mpeg'
          }, { quoted: m.rawMessage });
        } else {
          await conn.sendMessage(m.chat, {
            image: buffer,
            caption: i === 0 ? caption : undefined
          }, { quoted: m.rawMessage });
        }
      }

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando media:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el contenido. Intenta de nuevo.');
    }
  }
};

/**
 * Comando /cobalt - Usa específicamente la API de Cobalt
 */
export const cobaltPlugin: PluginHandler = {
  command: ['cobalt', 'cb'],
  description: 'Descargar usando Cobalt API (all-in-one)',
  category: 'download',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Parsear argumentos
    const args = text.trim().split(/\s+/);
    let url = '';
    let audioOnly = false;
    let quality = '720';

    for (const arg of args) {
      if (arg === '-a' || arg === '--audio') {
        audioOnly = true;
      } else if (arg.startsWith('-q=') || arg.startsWith('--quality=')) {
        quality = arg.split('=')[1];
      } else if (URL_REGEX.test(arg)) {
        url = arg;
      }
    }

    // Si no hay URL, intentar del mensaje citado
    if (!url && m.quoted?.text) {
      const match = m.quoted.text.match(URL_REGEX);
      if (match) url = match[0];
    }

    if (!url) {
      await m.reply('🌐 *COBALT DOWNLOADER*\n\n📝 Uso: /cobalt <url> [opciones]\n\n⚙️ Opciones:\n• -a, --audio - Solo audio\n• -q=720 - Calidad (144-4320)\n\n📌 Ejemplos:\n/cobalt https://youtube.com/watch?v=xxx\n/cobalt https://tiktok.com/xxx -a\n/cobalt https://youtube.com/xxx -q=1080\n\n💡 Soporta: YouTube, TikTok, Instagram, Twitter, Reddit, Twitch, Vimeo, SoundCloud, y más!');
      return;
    }

    await m.react('⏳');

    const result = await downloadWithCobalt(url, {
      videoQuality: quality as any,
      downloadMode: audioOnly ? 'audio' : 'auto'
    });

    if (!result.success || !result.medias || result.medias.length === 0) {
      await m.react('❌');
      await m.reply(`❌ ${result.error || 'No se pudo descargar el contenido'}`);
      return;
    }

    try {
      const platform = detectPlatform(url);
      const emoji = PLATFORM_EMOJI[platform];
      const name = PLATFORM_NAME[platform];

      for (let i = 0; i < result.medias.length && i < 5; i++) {
        const media = result.medias[i];
        const response = await fetch(media.url);
        const buffer = Buffer.from(await response.arrayBuffer());

        const caption = i === 0 ? `${emoji} *${name}* via Cobalt\n${audioOnly ? '🎵 Solo audio' : `📺 Calidad: ${quality}p`}` : undefined;

        if (media.type === 'audio' || audioOnly) {
          await conn.sendMessage(m.chat, {
            audio: buffer,
            mimetype: 'audio/mpeg',
            ptt: false
          }, { quoted: m.rawMessage });
          if (caption) await m.reply(caption);
        } else if (media.type === 'video') {
          await conn.sendMessage(m.chat, {
            video: buffer,
            caption,
            mimetype: 'video/mp4'
          }, { quoted: m.rawMessage });
        } else {
          await conn.sendMessage(m.chat, {
            image: buffer,
            caption
          }, { quoted: m.rawMessage });
        }
      }

      await m.react('✅');
    } catch (error) {
      console.error('Error enviando media Cobalt:', error);
      await m.react('❌');
      await m.reply('❌ Error al enviar el contenido. Intenta de nuevo.');
    }
  }
};
