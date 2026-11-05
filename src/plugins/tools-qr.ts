import QRCode from 'qrcode';
import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('tools');
const MAX_QR_CHARS = 1000;

export const qrPlugin: PluginHandler = {
  command: ['qr', 'qrcode'],
  description: 'Genera un código QR a partir de un texto o enlace',
  category: 'herramientas',
  help: [`qr <texto o enlace> - Genera un código QR (máximo ${MAX_QR_CHARS} caracteres; también vale citar un mensaje)`],
  usage: ['qr https://ejemplo.com', 'qr Hola mundo'],

  handler: async ({ m, text, usedPrefix, send }) => {
    const content = text.trim() || m.quoted?.text?.trim() || '';
    if (!content) {
      await m.reply(`Escribe el texto o enlace: *${usedPrefix}qr https://ejemplo.com*`);
      return;
    }
    if (content.length > MAX_QR_CHARS) {
      await m.reply(`Demasiado largo: ${content.length} caracteres, máximo ${MAX_QR_CHARS}.`);
      return;
    }
    try {
      const image = await QRCode.toBuffer(content, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
      await send({ image, caption: content.length > 80 ? `${content.slice(0, 77)}…` : content }, { quoted: m.rawMessage });
    } catch (error) {
      log.error('no se pudo generar el QR:', error instanceof Error ? error.message : error);
      await m.reply('No pude generar el QR con ese contenido.');
    }
  },
};
