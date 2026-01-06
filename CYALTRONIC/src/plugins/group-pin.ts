/**
 * 📌 Plugin de Fijar Mensajes
 * Comando: pin - Fija un mensaje con duración opcional
 * Nota: WhatsApp Web/Baileys tiene soporte limitado para pin de mensajes
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI } from '../lib/utils.js';

/**
 * Almacén de mensajes fijados con temporizador
 * Estructura: Map<chatId, { messageKey, text, sender, timestamp, timeout?, duration? }>
 */
interface PinnedMessage {
  messageKey: string;
  text: string;
  sender: string;
  pinnedBy: string;
  timestamp: number;
  duration?: number;
  timeout?: NodeJS.Timeout;
}

const pinnedMessages = new Map<string, PinnedMessage>();

/**
 * Parsea la duración del texto
 * Formatos soportados: 30s, 5m, 2h, 1d o combinaciones como "1h30m"
 */
function parseDuration(text: string): number | null {
  if (!text) return null;

  const timeRegex = /(\d+)\s*(s|seg|segundo|segundos|m|min|minuto|minutos|h|hora|horas|d|dia|días|day|days)/gi;
  let totalMs = 0;
  let match;

  while ((match = timeRegex.exec(text)) !== null) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 's':
      case 'seg':
      case 'segundo':
      case 'segundos':
        totalMs += value * 1000;
        break;
      case 'm':
      case 'min':
      case 'minuto':
      case 'minutos':
        totalMs += value * 60 * 1000;
        break;
      case 'h':
      case 'hora':
      case 'horas':
        totalMs += value * 60 * 60 * 1000;
        break;
      case 'd':
      case 'dia':
      case 'días':
      case 'day':
      case 'days':
        totalMs += value * 24 * 60 * 60 * 1000;
        break;
    }
  }

  return totalMs > 0 ? totalMs : null;
}

/**
 * Formatea milisegundos a texto legible
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days} día${days > 1 ? 's' : ''}`);
  if (hours % 24 > 0) parts.push(`${hours % 24} hora${hours % 24 > 1 ? 's' : ''}`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60} minuto${minutes % 60 > 1 ? 's' : ''}`);
  if (seconds % 60 > 0 && days === 0 && hours === 0) {
    parts.push(`${seconds % 60} segundo${seconds % 60 > 1 ? 's' : ''}`);
  }

  return parts.join(' ') || 'unos segundos';
}

/**
 * Plugin: Pin - Fijar mensaje (simulado con almacenamiento local)
 */
const pinPlugin: PluginHandler = {
  command: ['pin', 'fijar', 'anclar'],
  tags: ['grupo', 'admin'],
  help: [
    'pin [duración] - Fija el mensaje respondido',
    'Duraciones: 30s, 5m, 2h, 1d',
    'Ejemplos: /pin 30m, /pin 1h, /pin 2d',
    'Sin duración = permanente',
    'Usa /pinned para ver el mensaje fijado'
  ],
  group: true,
  admin: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;

    // Verificar que se responda a un mensaje
    if (!m.quoted) {
      await m.reply(
        `${EMOJI.error} Debes *responder* al mensaje que quieres fijar.\n\n` +
        `📝 *Uso:* Responde a un mensaje y escribe:\n` +
        `   /pin - Fijar permanente\n` +
        `   /pin 30m - Fijar por 30 minutos\n` +
        `   /pin 2h - Fijar por 2 horas\n` +
        `   /pin 1d - Fijar por 1 día\n\n` +
        `💡 Usa */pinned* para ver el mensaje fijado.`
      );
      return;
    }

    const chatId = m.chat;
    const quotedText = m.quoted.text || '[Mensaje sin texto]';
    const quotedSender = m.quoted.sender;
    const messageKey = m.quoted.key.id || '';

    // Parsear duración si se proporciona
    const duration = parseDuration(text);

    // Si ya hay un mensaje fijado con temporizador, cancelarlo
    const existingPin = pinnedMessages.get(chatId);
    if (existingPin?.timeout) {
      clearTimeout(existingPin.timeout);
    }

    // Crear el nuevo pin
    const newPin: PinnedMessage = {
      messageKey,
      text: quotedText.length > 500 ? quotedText.substring(0, 500) + '...' : quotedText,
      sender: quotedSender,
      pinnedBy: m.sender,
      timestamp: Date.now(),
      duration: duration ?? undefined
    };

    // Si hay duración, programar la eliminación
    if (duration) {
      newPin.timeout = setTimeout(() => {
        pinnedMessages.delete(chatId);
        // Notificar que se desfijó (opcional, se podría enviar mensaje)
      }, duration);
    }

    pinnedMessages.set(chatId, newPin);

    const senderName = quotedSender.split('@')[0];

    if (duration) {
      await m.reply(
        `📌 *¡Mensaje fijado!*\n\n` +
        `👤 De: @${senderName}\n` +
        `⏱️ Duración: *${formatDuration(duration)}*\n\n` +
        `💬 _"${quotedText.substring(0, 100)}${quotedText.length > 100 ? '...' : ''}"_\n\n` +
        `💡 Usa */pinned* para ver el mensaje completo.`
      );
    } else {
      await m.reply(
        `📌 *¡Mensaje fijado permanentemente!*\n\n` +
        `👤 De: @${senderName}\n\n` +
        `💬 _"${quotedText.substring(0, 100)}${quotedText.length > 100 ? '...' : ''}"_\n\n` +
        `💡 Usa */pinned* para ver el mensaje completo.`
      );
    }

    await m.react('📌');
  }
};

/**
 * Plugin: Unpin - Desfijar mensaje
 */
const unpinPlugin: PluginHandler = {
  command: ['unpin', 'desfijar', 'desanclar'],
  tags: ['grupo', 'admin'],
  help: ['unpin - Quita el mensaje fijado'],
  group: true,
  admin: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const chatId = m.chat;

    const existingPin = pinnedMessages.get(chatId);

    if (!existingPin) {
      await m.reply(`${EMOJI.warning} No hay ningún mensaje fijado en este grupo.`);
      return;
    }

    // Cancelar temporizador si existe
    if (existingPin.timeout) {
      clearTimeout(existingPin.timeout);
    }

    pinnedMessages.delete(chatId);

    await m.reply(`${EMOJI.success} *Mensaje desfijado correctamente.*`);
    await m.react('✅');
  }
};

/**
 * Plugin: Pinned - Ver mensaje fijado
 */
const pinnedPlugin: PluginHandler = {
  command: ['pinned', 'fijado', 'anclado', 'verpin'],
  tags: ['grupo'],
  help: ['pinned - Muestra el mensaje fijado actual'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const chatId = m.chat;

    const pin = pinnedMessages.get(chatId);

    if (!pin) {
      await m.reply(`${EMOJI.info} No hay ningún mensaje fijado en este grupo.`);
      return;
    }

    const senderName = pin.sender.split('@')[0];
    const pinnedByName = pin.pinnedBy.split('@')[0];
    const timeAgo = Date.now() - pin.timestamp;
    const timeAgoStr = formatDuration(timeAgo);

    let response = `📌 *MENSAJE FIJADO*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `💬 ${pin.text}\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `👤 *Autor:* @${senderName}\n`;
    response += `📍 *Fijado por:* @${pinnedByName}\n`;
    response += `⏰ *Hace:* ${timeAgoStr}\n`;

    if (pin.duration) {
      const remaining = pin.duration - timeAgo;
      if (remaining > 0) {
        response += `⏳ *Se desfija en:* ${formatDuration(remaining)}`;
      }
    } else {
      response += `♾️ *Duración:* Permanente`;
    }

    await m.reply(response);
  }
};

/**
 * Registra los plugins de pin
 */
export function registerGroupPinPlugins(handler: MessageHandler): void {
  handler.registerPlugin('pin', pinPlugin);
  handler.registerPlugin('unpin', unpinPlugin);
  handler.registerPlugin('pinned', pinnedPlugin);
}
