import type { MessageContext, PluginHandler } from '../types/message.js';
import { CONFIG } from '../config.js';
import { fetchMedia } from '../lib/fetch-media.js';
import { getQuotedOrOwnMedia, replyMediaError } from '../lib/media.js';
import { addExif, createSticker, MAX_ANIMATED_SECONDS, type StickerMetadata } from '../lib/sticker.js';
import { extractUrl, URL_REGEX } from '../lib/downloaders.js';

/** Un video de más de 5 MB no cabe en un sticker de 8 s sin destrozar la calidad. */
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const URL_TIMEOUT_MS = 15_000;

export interface StickerArgs {
  crop: boolean;
  packname?: string;
  author?: string;
  url: string | null;
}

/** "/s full", "/s Mi pack|Yo", "/s https://..." (y combinaciones). */
export function parseStickerArgs(text: string): StickerArgs {
  let rest = text.trim();
  const url = extractUrl(rest, undefined, URL_REGEX);
  if (url) rest = rest.replace(url, '').trim();
  let crop = true;
  const words = rest.split(/\s+/).filter(Boolean);
  if (words[0]?.toLowerCase() === 'full') {
    crop = false;
    words.shift();
  }
  rest = words.join(' ');
  if (!rest) return { crop, url };
  const [packname, author] = rest.split('|').map((s) => s.trim());
  return { crop, url, packname: packname || undefined, author: author || undefined };
}

const HELP =
  '🎨 *CREAR STICKER*\n\n' +
  '• Responde a una imagen o video con /s\n' +
  '• Envía una imagen con /s en el caption\n' +
  '• /s <url de imagen>\n' +
  '• /s full → sin recortar (bordes transparentes)\n' +
  '• /s Mi pack|Mi nombre → pack y autor\n' +
  '• Responde a un sticker con /s (o /stealsticker) para hacerlo tuyo\n\n' +
  `📷 JPG, PNG, WEBP, GIF · 🎬 videos de hasta ${MAX_ANIMATED_SECONDS} s (máx 5 MB)`;

export const stickerPlugin: PluginHandler = {
  // 'steal' y 'robar' pertenecen a rpg-robar (el primer plugin registrado se queda el alias).
  command: ['s', 'sticker', 'stiker', 'stick', 'stealsticker'],
  description: 'Crear sticker a partir de una imagen, video o URL',
  category: 'media',
  usage: ['s (respondiendo a imagen/video)', 's full', 's <pack>|<autor>', 's <url>', 'stealsticker (respondiendo a sticker)'],

  async handler(ctx: MessageContext) {
    const { m, text, send } = ctx;
    const args = parseStickerArgs(text);
    const metadata: StickerMetadata = {
      packname: args.packname ?? CONFIG.botName,
      author: args.author ?? (m.pushName || 'Usuario'),
      categories: ['🎨'],
    };

    try {
      let input: Buffer | null = null;
      let isSticker = false;

      if (args.url) {
        await m.react('⏳');
        const fetched = await fetchMedia(args.url, { maxBytes: MAX_INPUT_BYTES, timeoutMs: URL_TIMEOUT_MS });
        if (!fetched || !fetched.mimetype.startsWith('image/')) {
          await m.react('❌');
          await m.reply('❌ No pude bajar una imagen de ese enlace (debe ser una imagen de hasta 5 MB).');
          return;
        }
        input = fetched.buffer;
      } else {
        const media = await getQuotedOrOwnMedia(ctx, ['image', 'video', 'sticker'], { maxBytes: MAX_INPUT_BYTES });
        if (!media) {
          await m.reply(HELP);
          return;
        }
        await m.react('⏳');
        input = media.buffer;
        isSticker = media.kind === 'sticker';
      }

      // Un sticker ya está en 512x512 WebP: solo se reescribe el pack/autor.
      const sticker = isSticker
        ? await addExif(input, metadata.packname, metadata.author, metadata.categories)
        : await createSticker(input, metadata, { crop: args.crop });

      await send({ sticker }, { quoted: m.rawMessage });
      await m.react('✅');
    } catch (error) {
      await m.react('❌');
      await replyMediaError(m, error, '❌ No se pudo crear el sticker. Prueba con otra imagen o un video más corto.');
    }
  },
};
