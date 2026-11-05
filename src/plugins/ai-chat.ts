/**
 * Comandos de la IA: /ia, /resumen, /iastats.
 * En privado y en menciones la IA responde sin comando (ver handler).
 */

import type { PluginHandler } from '../types/message.js';
import { CONFIG } from '../config.js';
import { getDatabase } from '../lib/database.js';
import { isAIEnabled, respondWithAI, resetMemory, summarizeChat, getUsageSummary } from '../lib/ai.js';
import { formatNumber } from '../lib/utils.js';

const DISABLED = 'La IA no está configurada en este bot (falta ANTHROPIC_API_KEY).';

export const aiPlugin: PluginHandler = {
  command: ['ia', 'ai', 'bot', 'claude', 'pregunta', 'preguntar'],
  description: 'Pregúntale algo al bot',
  category: 'ia',
  help: [
    'ia <pregunta> - Pregúntale algo al bot (recuerda la conversación un rato)',
    'ia reset - Olvida la conversación de este chat',
  ],

  handler: async (ctx) => {
    const { m, text, usedPrefix, isOwner, conn } = ctx;
    if (!isAIEnabled()) return void m.reply(DISABLED);

    const arg = text.trim();
    if (/^(reset|olvida|olvidar|borrar|limpiar)$/i.test(arg)) {
      resetMemory(m.chat);
      return void m.reply('Listo, empezamos de cero.');
    }

    const hasImage = Boolean(m.rawMessage?.message?.imageMessage || m.quoted?.message?.imageMessage);
    if (!arg && !hasImage) {
      return void m.reply(
        `Escribe tu pregunta después del comando: *${usedPrefix}ia ¿qué es un agujero negro?*\n` +
        `También puedes responder a una imagen con *${usedPrefix}ia* para que te diga qué ve.` +
        (m.isGroup ? `\nEn el grupo basta con mencionarme o responder a uno de mis mensajes.` : ''),
      );
    }

    await respondWithAI({ conn, m, rawMessage: m.rawMessage!, text: arg, isOwner });
  },
};

export const aiToggleAdminPlugin: PluginHandler = {
  command: ['iachat', 'aichat', 'iamenciones'],
  description: 'Activa o desactiva que la IA responda a menciones en este grupo',
  category: 'ia',
  help: ['iachat on|off - La IA responde (o no) cuando la mencionan en este grupo'],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const current = db.getChatSettings(m.chat).aiChat !== false;
    const want = args[0]?.toLowerCase();

    if (want !== 'on' && want !== 'off') {
      return void m.reply(`La IA por menciones está *${current ? 'activada' : 'desactivada'}* en este grupo. Usa *iachat on* u *off*.`);
    }
    db.updateChatSettings(m.chat, { aiChat: want === 'on' });
    await m.reply(want === 'on'
      ? 'Listo. Mencióname o responde a un mensaje mío y te contesto.'
      : 'Listo. En este grupo solo respondo con el comando /ia.');
  },
};

export const resumenPlugin: PluginHandler = {
  command: ['resumen', 'resume', 'summary', 'tldr'],
  description: 'Resume los últimos mensajes del grupo',
  category: 'ia',
  help: ['resumen [n] - Resume los últimos n mensajes del grupo (por defecto 100)'],
  group: true,

  handler: async (ctx) => {
    const { m, args, conn } = ctx;
    if (!isAIEnabled()) return void m.reply(DISABLED);
    const n = parseInt(args[0] ?? '', 10);
    await conn.sendPresenceUpdate('composing', m.chat).catch(() => undefined);
    try {
      const summary = await summarizeChat(m.chat, Number.isFinite(n) && n > 0 ? n : 100);
      await m.reply(summary);
    } catch (error) {
      await m.reply('No pude generar el resumen ahora. Intenta más tarde.');
      console.error('resumen:', error instanceof Error ? error.message : error);
    }
  },
};

export const aiStatsPlugin: PluginHandler = {
  command: ['iastats', 'aistats', 'iauso'],
  description: 'Uso de la IA hoy',
  category: 'ia',
  help: ['iastats - Consumo de tokens de la IA (owner)'],
  owner: true,

  handler: async (ctx) => {
    const { m } = ctx;
    if (!isAIEnabled()) return void m.reply(DISABLED);
    const { today, conversations } = getUsageSummary();
    const total = today.inputTokens + today.outputTokens;
    const budget = CONFIG.ai.dailyTokenBudget > 0 ? ` de ${formatNumber(CONFIG.ai.dailyTokenBudget)}` : '';
    await m.reply(
      `*IA hoy* (${CONFIG.ai.model})\n` +
      `• Peticiones: ${today.requests}\n` +
      `• Tokens entrada: ${formatNumber(today.inputTokens)} (${formatNumber(today.cacheReadTokens)} desde caché)\n` +
      `• Tokens salida: ${formatNumber(today.outputTokens)}\n` +
      `• Total: ${formatNumber(total)}${budget}\n` +
      `• Conversaciones en memoria: ${conversations}`,
    );
  },
};
