import { proto } from 'baileys';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('grupos');

/** Duraciones que acepta WhatsApp, en segundos. */
const PIN_DURATIONS = {
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
} as const;

type PinSeconds = (typeof PIN_DURATIONS)[keyof typeof PIN_DURATIONS];

const DURATION_LABEL: Record<PinSeconds, string> = {
  86400: '24 horas',
  604800: '7 días',
  2592000: '30 días',
};

/** Sin texto: 24h. Texto no reconocido: null, para que el usuario vea las opciones. */
export function parsePinDuration(text: string): PinSeconds | null {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return PIN_DURATIONS['24h'];
  if (/^(24\s*h(oras)?|1\s*d(ia)?|dia|day)$/.test(normalized)) return PIN_DURATIONS['24h'];
  if (/^(7\s*d(ias)?|semana|week)$/.test(normalized)) return PIN_DURATIONS['7d'];
  if (/^(30\s*d(ias)?|mes|month)$/.test(normalized)) return PIN_DURATIONS['30d'];
  return null;
}

export const pinPlugin: PluginHandler = {
  command: ['pin', 'fijar', 'anclar'],
  tags: ['grupo', 'admin'],
  help: ['pin [24h|7d|30d] - Fija el mensaje respondido (24h por defecto)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx: MessageContext) => {
    const { conn, m, text, usedPrefix } = ctx;
    const options = `• ${usedPrefix}pin - 24 horas\n• ${usedPrefix}pin 7d - 7 días\n• ${usedPrefix}pin 30d - 30 días`;

    if (!m.quoted) {
      await m.reply(`❌ Debes *responder* al mensaje que quieres fijar.\n\n📝 Opciones:\n${options}`);
      return;
    }

    const duration = parsePinDuration(text);
    if (duration === null) {
      await m.reply(`❌ Duración no válida: "${text.trim()}". WhatsApp solo permite:\n${options}`);
      return;
    }

    try {
      await conn.sendMessage(m.chat, {
        pin: m.quoted.key,
        type: proto.PinInChat.Type.PIN_FOR_ALL,
        time: duration,
      });
      await m.react('📌');
      if (!ctx.handler.isCompactMode(m.chat)) {
        await m.reply(`📌 Mensaje fijado por *${DURATION_LABEL[duration]}*.`);
      }
    } catch (error) {
      log.warn(`pin en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply(
        `❌ No se pudo fijar el mensaje.\n\nPosibles causas:\n• El mensaje es muy antiguo\n• Ya hay 3 mensajes fijados (límite de WhatsApp)`,
      );
    }
  },
};

export const unpinPlugin: PluginHandler = {
  command: ['unpin', 'desfijar', 'desanclar'],
  tags: ['grupo', 'admin'],
  help: ['unpin - Quita el pin del mensaje respondido'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx: MessageContext) => {
    const { conn, m } = ctx;
    if (!m.quoted) {
      await m.reply('❌ Debes *responder* al mensaje fijado que quieres desfijar.');
      return;
    }

    try {
      await conn.sendMessage(m.chat, { pin: m.quoted.key, type: proto.PinInChat.Type.UNPIN_FOR_ALL });
      await m.react('✅');
    } catch (error) {
      log.warn(`unpin en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No se pudo desfijar el mensaje. Asegúrate de que esté fijado.');
    }
  },
};
