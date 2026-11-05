/**
 * Plugin de Fijar Mensajes
 * Comando: pin - Fija un mensaje usando la API nativa de WhatsApp
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI } from '../lib/utils.js';
import { proto } from 'baileys';

/**
 * Duraciones permitidas por WhatsApp (en segundos)
 */
const PIN_DURATIONS = {
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000
} as const;

/**
 * Parsea la duración del texto y devuelve segundos
 * WhatsApp solo permite: 24h, 7d, 30d
 */
function parseDuration(text: string): number {
  if (!text) return PIN_DURATIONS['24h']; // Por defecto 24h

  const normalized = text.toLowerCase().trim();

  // Buscar patrones comunes
  if (/^(24\s*h|1\s*d|dia|day)/.test(normalized)) {
    return PIN_DURATIONS['24h'];
  }
  if (/^(7\s*d|semana|week)/.test(normalized)) {
    return PIN_DURATIONS['7d'];
  }
  if (/^(30\s*d|mes|month)/.test(normalized)) {
    return PIN_DURATIONS['30d'];
  }

  // Por defecto 24h
  return PIN_DURATIONS['24h'];
}

/**
 * Formatea segundos a texto legible
 */
function formatDuration(seconds: number): string {
  if (seconds === PIN_DURATIONS['24h']) return '24 horas';
  if (seconds === PIN_DURATIONS['7d']) return '7 días';
  if (seconds === PIN_DURATIONS['30d']) return '30 días';
  return `${seconds} segundos`;
}

/**
 * Plugin: Pin - Fijar mensaje usando API nativa de WhatsApp
 */
const pinPlugin: PluginHandler = {
  command: ['pin', 'fijar', 'anclar'],
  tags: ['grupo', 'admin'],
  help: [
    'pin [duración] - Fija el mensaje respondido',
    'Duraciones: 24h (defecto), 7d, 30d',
    'Ejemplos: /pin, /pin 7d, /pin 30d'
  ],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx: MessageContext) => {
    const { conn, m, text } = ctx;

    // Verificar que se responda a un mensaje
    if (!m.quoted) {
      await m.reply(
        `${EMOJI.error} Debes *responder* al mensaje que quieres fijar.\n\n` +
        `📝 *Uso:* Responde a un mensaje y escribe:\n` +
        `   /pin - Fijar por 24 horas\n` +
        `   /pin 7d - Fijar por 7 días\n` +
        `   /pin 30d - Fijar por 30 días`
      );
      return;
    }

    const chatId = m.chat;
    const duration = parseDuration(text);

    try {
      // Usar la API nativa de WhatsApp para fijar el mensaje
      await conn.sendMessage(chatId, {
        pin: m.quoted.key,
        type: proto.PinInChat.Type.PIN_FOR_ALL,
        time: duration as 86400 | 604800 | 2592000
      });

      const senderName = m.quoted.sender.split('@')[0];

      await m.reply(
        `📌 *¡Mensaje fijado!*\n\n` +
        `👤 De: @${senderName}\n` +
        `⏱️ Duración: *${formatDuration(duration)}*`
      );

      await m.react('📌');
    } catch (error) {
      console.error('Error al fijar mensaje:', error);
      await m.reply(
        `${EMOJI.error} No se pudo fijar el mensaje.\n\n` +
        `Posibles causas:\n` +
        `• El bot necesita ser admin\n` +
        `• El mensaje es muy antiguo\n` +
        `• Ya hay 3 mensajes fijados (límite de WhatsApp)`
      );
    }
  }
};

/**
 * Plugin: Unpin - Desfijar mensaje usando API nativa
 */
const unpinPlugin: PluginHandler = {
  command: ['unpin', 'desfijar', 'desanclar'],
  tags: ['grupo', 'admin'],
  help: ['unpin - Quita el pin del mensaje respondido'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx: MessageContext) => {
    const { conn, m } = ctx;

    // Verificar que se responda a un mensaje
    if (!m.quoted) {
      await m.reply(
        `${EMOJI.error} Debes *responder* al mensaje fijado que quieres desfijar.`
      );
      return;
    }

    const chatId = m.chat;

    try {
      // Usar la API nativa de WhatsApp para desfijar
      await conn.sendMessage(chatId, {
        pin: m.quoted.key,
        type: proto.PinInChat.Type.UNPIN_FOR_ALL
      });

      await m.reply(`${EMOJI.success} *Mensaje desfijado correctamente.*`);
      await m.react('✅');
    } catch (error) {
      console.error('Error al desfijar mensaje:', error);
      await m.reply(
        `${EMOJI.error} No se pudo desfijar el mensaje.\n\n` +
        `Asegúrate de que el mensaje esté fijado actualmente.`
      );
    }
  }
};

/**
 * Registra los plugins de pin
 */
export function registerGroupPinPlugins(handler: MessageHandler): void {
  handler.registerPlugin('pin', pinPlugin);
  handler.registerPlugin('unpin', unpinPlugin);
}
