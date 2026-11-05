/**
 * Picks del sistema de betting: registrar, resolver, seguir, cancelar y listar.
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import type { BettingPick } from '../types/database.js';
import { getDatabase } from '../lib/database.js';
import { MAX_FAVORITE_TIPSTERS, TELEGRAM_BRIDGE_AUTHOR } from '../lib/betting-store.js';
import {
  extractTipsterNameLegacy, findPickFromContext, describePendingPicks, requireBetting, formatRecord, formatStreak, BETTING_SEPARATOR,
} from '../lib/betting-parser.js';

/**
 * Quién puede resolver o cancelar un pick: admins y owner siempre; el autor del
 * pick; y, en los picks del puente de Telegram (sin autor humano), quienes lo siguen.
 */
function canManagePick(pick: BettingPick, ctx: Pick<MessageContext, 'm' | 'isAdmin' | 'isOwner'>): boolean {
  if (ctx.isAdmin || ctx.isOwner) return true;
  if (pick.createdBy === TELEGRAM_BRIDGE_AUTHOR) return pick.followers.includes(ctx.m.sender);
  return pick.createdBy === ctx.m.sender;
}

export const pickPlugin: PluginHandler = {
  command: ['pick', 'apuesta'],
  tags: ['betting'],
  description: 'Registra un pick respondiendo al mensaje del tipster',
  help: ['pick [unidades] - Registrar un pick (responde a un mensaje que empiece con #Tipster)'],
  usage: ['pick', 'pick 2'],
  group: true,

  handler: async (ctx) => {
    const { m, text, usedPrefix } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    if (!m.quoted) {
      return m.reply(`❌ Responde con *${usedPrefix}pick* al mensaje del tipster (el que empieza con #NombreTipster).`);
    }

    const quotedText = m.quoted.text || '';
    const tipsterName = extractTipsterNameLegacy(quotedText);
    if (!tipsterName) {
      return m.reply('❌ El mensaje citado no empieza con #NombreTipster, así que no sé de quién es el pick.');
    }

    let units = 1;
    if (text.trim()) {
      const parsedUnits = parseFloat(text.replace(',', '.'));
      if (!Number.isFinite(parsedUnits) || parsedUnits < 0.1 || parsedUnits > 100) {
        return m.reply('❌ Las unidades deben ser un número entre 0.1 y 100.');
      }
      units = parsedUnits;
    }

    const normalizedTipster = store.normalizeTipsterName(tipsterName);
    if (m.quoted.key.id) {
      const existingPick = store.getPickByMessageId(m.chat, m.quoted.key.id);
      if (existingPick && existingPick.tipster === normalizedTipster && existingPick.status === 'pending') {
        return m.reply(
          `❌ Ese pick ya está registrado y pendiente (id ${existingPick.id.slice(-8)}, ${existingPick.units}u).\n` +
          `Resuélvelo con *${usedPrefix}verde* o *${usedPrefix}roja*.`,
        );
      }
    }

    const pick = store.registerPick(m.chat, {
      tipster: normalizedTipster,
      tipsterOriginal: tipsterName,
      description: quotedText.substring(0, 500),
      units,
      status: 'pending',
      createdAt: Date.now(),
      createdBy: m.sender,
      followers: [m.sender],
      messageId: m.quoted.key.id || undefined,
    });
    store.getUserBetting(m.sender).stats.totalFollowed++;
    getDatabase().markDirty();

    const follow = store.followTipsterStatus(m.chat, tipsterName, m.sender);
    const followNote = follow === 'ok'
      ? '\n🔔 Te suscribí a este tipster; sus próximos picks te mencionarán.'
      : follow === 'limit' ? `\nℹ️ No lo añadí a tus favoritos: ya tienes ${MAX_FAVORITE_TIPSTERS}.` : '';

    const tipster = store.getTipster(m.chat, tipsterName);
    const sent = await m.reply(
      `✅ *PICK REGISTRADO*\n\n` +
      `🎫 Tipster: ${tipsterName}\n` +
      `📊 Record: ${formatRecord(tipster)}\n` +
      `💰 Unidades: ${units}\n` +
      `🆔 ID: ${pick.id.slice(-8)}\n\n` +
      `Responde a este mensaje con *${usedPrefix}verde* o *${usedPrefix}roja* para resolverlo.` +
      followNote,
    );
    store.rememberReply(m.chat, sent?.key?.id, pick.id);
  },
};

/** /verde y /roja comparten todo salvo el resultado y los textos. */
export function makeResolveCommand(won: boolean): PluginHandler {
  const name = won ? 'verde' : 'roja';
  return {
    command: won ? ['verde', 'green', 'win', 'won', 'ganado'] : ['roja', 'red', 'loss', 'lost', 'perdido'],
    tags: ['betting'],
    description: won ? 'Marca un pick como ganado' : 'Marca un pick como perdido',
    help: [`${name} [id|número] - Marcar un pick como ${won ? 'ganado' : 'perdido'} (responde al pick o indica su id)`],
    usage: [name, `${name} 2`, `${name} a1b2c3d4`],
    group: true,

    handler: async (ctx) => {
      const { m, text, usedPrefix } = ctx;
      const store = getDatabase().betting;
      if (!(await requireBetting(ctx))) return;

      const pick = findPickFromContext(store, m.chat, m.quoted?.key.id, text);
      if (!pick) {
        return m.reply(describePendingPicks(store.getPendingPicks(m.chat), usedPrefix, name));
      }
      if (pick.status !== 'pending') {
        return m.reply(`❌ Ese pick ya se resolvió como ${pick.status === 'won' ? '✅ ganado' : '❌ perdido'}.`);
      }
      if (!canManagePick(pick, ctx)) {
        return m.reply('❌ Solo quien registró el pick, quienes lo siguen (si vino de Telegram) o un admin pueden resolverlo.');
      }

      const resolved = store.resolvePick(m.chat, pick.id, won, m.sender);
      if (!resolved) return m.reply('❌ No pude resolver el pick.');

      const tipster = store.getTipster(m.chat, resolved.tipsterOriginal);
      const sent = await m.reply(
        `${won ? '✅ *PICK GANADO*' : '❌ *PICK PERDIDO*'}\n\n` +
        `🎫 Tipster: ${resolved.tipsterOriginal}\n` +
        `💰 Unidades: ${won ? '+' : '-'}${resolved.units}\n` +
        `📊 Nuevo record: ${formatRecord(tipster)}\n` +
        `Racha: ${formatStreak(tipster?.currentStreak ?? 0)}\n` +
        `👥 Seguidores: ${resolved.followers.length}`,
      );
      store.rememberReply(m.chat, sent?.key?.id, resolved.id);
    },
  };
}

export const verdePlugin = makeResolveCommand(true);
export const rojaPlugin = makeResolveCommand(false);

export const pendientesPlugin: PluginHandler = {
  command: ['pendientes', 'pending', 'activos', 'picks'],
  tags: ['betting'],
  description: 'Picks sin resolver',
  help: ['pendientes [tipster] - Ver picks pendientes'],
  usage: ['pendientes', 'pendientes Tipster1'],
  group: true,

  handler: async (ctx) => {
    const { m, text, usedPrefix } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    const picks = store.getPendingPicks(m.chat, text.trim() || undefined);
    if (picks.length === 0) {
      return m.reply(text.trim() ? `📋 No hay picks pendientes de ${text.trim()}.` : '📋 No hay picks pendientes.');
    }

    let msg = `📋 *PICKS PENDIENTES* (${picks.length})\n${BETTING_SEPARATOR}\n\n`;
    picks.slice(0, 15).forEach((pick, i) => {
      const elapsed = Date.now() - pick.createdAt;
      const hours = Math.floor(elapsed / 3_600_000);
      const mins = Math.floor((elapsed % 3_600_000) / 60_000);
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      const lock = canManagePick(pick, ctx) ? '🔓' : '🔒';
      msg += `${i + 1}. 🎫 *${pick.tipsterOriginal}* ${lock}\n`;
      msg += `   💰 ${pick.units}u · 👥 ${pick.followers.length} · ⏰ ${timeStr} · id ${pick.id.slice(-8)}\n`;
    });
    if (picks.length > 15) msg += `\n… y ${picks.length - 15} más\n`;
    msg += `\n🔓 puedes resolverlo · 🔒 solo su autor o un admin\n`;
    msg += `*${usedPrefix}verde <n>* / *${usedPrefix}roja <n>* para resolver, *${usedPrefix}cancelar <n>* para anular.`;
    await m.reply(msg);
  },
};

export const seguirPickPlugin: PluginHandler = {
  command: ['seguir', 'follow', 'unirme'],
  tags: ['betting'],
  description: 'Sigue un pick activo',
  help: ['seguir [id|número] - Seguir un pick activo (responde al mensaje del pick)'],
  usage: ['seguir', 'seguir 1'],
  group: true,

  handler: async (ctx) => {
    const { m, text, usedPrefix } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    const pick = findPickFromContext(store, m.chat, m.quoted?.key.id, text);
    if (!pick) return m.reply(describePendingPicks(store.getPendingPicks(m.chat), usedPrefix, 'seguir'));
    if (pick.status !== 'pending') return m.reply('❌ Ese pick ya se resolvió, no se puede seguir.');
    if (pick.followers.includes(m.sender)) return m.reply('Ya sigues ese pick.');

    if (!store.followPick(m.chat, pick.id, m.sender)) return m.reply('❌ No pude seguir el pick.');
    await m.reply(`✅ Sigues el pick de *${pick.tipsterOriginal}* (${pick.units}u). Seguidores: ${pick.followers.length}.`);
  },
};

export const cancelarPlugin: PluginHandler = {
  command: ['cancelar', 'cancel', 'void', 'push', 'anular'],
  tags: ['betting'],
  description: 'Anula un pick pendiente sin afectar estadísticas',
  help: ['cancelar [id|número] - Cancelar un pick pendiente (void/push, no afecta stats)'],
  usage: ['cancelar', 'cancelar 2'],
  group: true,

  handler: async (ctx) => {
    const { m, text, usedPrefix } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    const pick = findPickFromContext(store, m.chat, m.quoted?.key.id, text);
    if (!pick) return m.reply(describePendingPicks(store.getPendingPicks(m.chat), usedPrefix, 'cancelar'));
    if (pick.status !== 'pending') return m.reply('❌ Ese pick ya se resolvió; no se puede cancelar.');
    if (!canManagePick(pick, ctx)) return m.reply('❌ Solo quien registró el pick o un admin pueden cancelarlo.');

    const cancelled = store.cancelPick(m.chat, pick.id, m.sender);
    if (!cancelled) return m.reply('❌ No pude cancelar el pick.');
    await m.reply(
      `🚫 *PICK CANCELADO (VOID)*\n\n` +
      `🎫 Tipster: ${cancelled.tipsterOriginal}\n` +
      `💰 Unidades: ${cancelled.units} (devueltas)\n` +
      `👥 Seguidores: ${cancelled.followers.length}\n\n` +
      `No afecta las estadísticas del tipster.`,
    );
  },
};

export default [pickPlugin, verdePlugin, rojaPlugin, pendientesPlugin, seguirPickPlugin, cancelarPlugin];
