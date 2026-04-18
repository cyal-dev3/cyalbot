/**
 * 🎫 Plugin de Picks - Sistema de Betting CYALTRONIC
 * Comandos para registrar y gestionar picks de tipsters
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import {
  extractTipsterNameLegacy,
  findPickFromContext,
  BETTING_SEPARATOR
} from '../lib/betting-parser.js';

/**
 * Comando /pick - Registrar un pick (respondiendo a imagen de tipster)
 */
export const pickPlugin: PluginHandler = {
  command: /^(pick|apuesta|bet)$/i,
  tags: ['betting'],
  help: ['pick [unidades] - Registrar un pick (responde a imagen de tipster)'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado en este grupo.\nUsa /betting on para activarlo.');
    }

    if (!m.quoted) {
      return m.reply('❌ Debes responder a un mensaje de tipster para registrar el pick.\n\nResponde con /pick a un mensaje que contenga #NombreTipster');
    }

    const quotedText = m.quoted.text || '';

    const tipsterName = extractTipsterNameLegacy(quotedText);
    if (!tipsterName) {
      return m.reply('❌ El mensaje citado no contiene un tipster válido.\n\nBusca un mensaje que comience con #NombreTipster');
    }

    let units = 1;
    if (text) {
      const parsedUnits = parseFloat(text);
      if (!isNaN(parsedUnits) && parsedUnits >= 0.1 && parsedUnits <= 100) {
        units = parsedUnits;
      } else if (text.trim()) {
        return m.reply('❌ Las unidades deben ser un número entre 0.1 y 100.');
      }
    }

    // Evitar duplicados: mismo mensaje + mismo tipster + aún pendiente
    const normalizedTipster = db.normalizeTipsterName(tipsterName);
    if (m.quoted.key.id) {
      const existingPick = db.getPickByMessageId(m.chat, m.quoted.key.id);
      if (existingPick && existingPick.tipster === normalizedTipster && existingPick.status === 'pending') {
        return m.reply(
          `❌ Este pick ya está registrado y pendiente.\n\n` +
          `🎫 Tipster: ${existingPick.tipsterOriginal}\n` +
          `💰 Unidades: ${existingPick.units}\n` +
          `🆔 ID: ${existingPick.id.slice(-8)}\n\n` +
          `Usa /verde o /roja para resolverlo primero.`
        );
      }
    }

    const pick = db.registerPick(m.chat, {
      tipster: normalizedTipster,
      tipsterOriginal: tipsterName,
      description: quotedText.substring(0, 500),
      units,
      status: 'pending',
      createdAt: Date.now(),
      createdBy: m.sender,
      followers: [m.sender],
      messageId: m.quoted.key.id || undefined
    });

    const userBetting = db.getUserBetting(m.sender);
    userBetting.stats.totalFollowed++;

    const alreadyFollowing = userBetting.favoriteTipsters.includes(normalizedTipster);
    const autoFollowed = !alreadyFollowing ? db.followTipster(m.chat, tipsterName, m.sender) : false;

    const tipster = db.getTipster(m.chat, tipsterName);
    const record = tipster ? `${tipster.wins}W - ${tipster.losses}L` : 'Nuevo tipster';

    let followNote = '';
    if (autoFollowed) {
      followNote = '\n🔔 Auto-seguido a este tipster.';
    } else if (!alreadyFollowing && userBetting.favoriteTipsters.length >= 20) {
      followNote = '\nℹ️ No se agregó a favoritos (límite 20).';
    }

    await m.reply(
      `✅ PICK REGISTRADO\n\n` +
      `🎫 Tipster: ${tipsterName}\n` +
      `📊 Record: ${record}\n` +
      `💰 Unidades: ${units}\n` +
      `🆔 ID: ${pick.id.slice(-8)}\n\n` +
      `Usa /verde o /roja para marcar el resultado` +
      followNote
    );
  }
};

/**
 * Comando /verde - Marcar pick como ganado
 */
export const verdePlugin: PluginHandler = {
  command: /^(verde|green|win|won|ganado|g)$/i,
  tags: ['betting'],
  help: ['verde - Marcar el último pick como ganado'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, isAdmin, isOwner } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const pick = findPickFromContext(db, m.chat, m.quoted?.key.id, text);

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick pendiente.\n\nPuedes responder a un pick o usar /pendientes para ver los picks activos.');
    }

    if (pick.status !== 'pending') {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      return m.reply(`❌ Este pick ya fue resuelto como ${emoji} ${pick.status.toUpperCase()}`);
    }

    if (pick.createdBy !== 'TELEGRAM_BRIDGE' && pick.createdBy !== m.sender && !isAdmin && !isOwner) {
      return m.reply('❌ Solo admins o quien registró este pick puede marcarlo como ganado.');
    }

    const resolved = db.resolvePick(m.chat, pick.id, true, m.sender);
    if (!resolved) {
      return m.reply('❌ Error al resolver el pick.');
    }

    const tipster = db.getTipster(m.chat, resolved.tipsterOriginal);
    const winrate = tipster ? ((tipster.wins / (tipster.wins + tipster.losses)) * 100).toFixed(1) : '0';
    const streak = tipster?.currentStreak || 0;
    const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '➖';

    await m.reply(
      `✅ PICK GANADO\n\n` +
      `🎫 Tipster: ${resolved.tipsterOriginal}\n` +
      `💰 Unidades: +${resolved.units}\n` +
      `📊 Nuevo record: ${tipster?.wins}W - ${tipster?.losses}L (${winrate}%)\n` +
      `${streakEmoji} Racha: ${streak > 0 ? '+' : ''}${streak}\n` +
      `👥 Seguidores: ${resolved.followers.length}`
    );
  }
};

/**
 * Comando /roja - Marcar pick como perdido
 */
export const rojaPlugin: PluginHandler = {
  command: /^(roja|red|loss|lost|perdido|l)$/i,
  tags: ['betting'],
  help: ['roja - Marcar el último pick como perdido'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, isAdmin, isOwner } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const pick = findPickFromContext(db, m.chat, m.quoted?.key.id, text);

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick pendiente.\n\nPuedes responder a un pick o usar /pendientes para ver los picks activos.');
    }

    if (pick.status !== 'pending') {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      return m.reply(`❌ Este pick ya fue resuelto como ${emoji} ${pick.status.toUpperCase()}`);
    }

    if (pick.createdBy !== 'TELEGRAM_BRIDGE' && pick.createdBy !== m.sender && !isAdmin && !isOwner) {
      return m.reply('❌ Solo admins o quien registró este pick puede marcarlo como perdido.');
    }

    const resolved = db.resolvePick(m.chat, pick.id, false, m.sender);
    if (!resolved) {
      return m.reply('❌ Error al resolver el pick.');
    }

    const tipster = db.getTipster(m.chat, resolved.tipsterOriginal);
    const winrate = tipster ? ((tipster.wins / (tipster.wins + tipster.losses)) * 100).toFixed(1) : '0';
    const streak = tipster?.currentStreak || 0;
    const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '➖';

    await m.reply(
      `❌ PICK PERDIDO\n\n` +
      `🎫 Tipster: ${resolved.tipsterOriginal}\n` +
      `💰 Unidades: -${resolved.units}\n` +
      `📊 Nuevo record: ${tipster?.wins}W - ${tipster?.losses}L (${winrate}%)\n` +
      `${streakEmoji} Racha: ${streak > 0 ? '+' : ''}${streak}\n` +
      `👥 Seguidores: ${resolved.followers.length}`
    );
  }
};

/**
 * Comando /pendientes - Ver picks sin resolver
 */
export const pendientesPlugin: PluginHandler = {
  command: /^(pendientes|pending|activos|picks)$/i,
  tags: ['betting'],
  help: ['pendientes [tipster] - Ver picks pendientes'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const picks = db.getPendingPicks(m.chat, text || undefined);

    if (picks.length === 0) {
      return m.reply(text
        ? `📋 No hay picks pendientes de ${text}`
        : '📋 No hay picks pendientes en este momento.'
      );
    }

    let msg = `📋 PICKS PENDIENTES (${picks.length})\n${BETTING_SEPARATOR}\n\n`;

    for (const pick of picks.slice(0, 15)) {
      const timeSince = Date.now() - pick.createdAt;
      const hours = Math.floor(timeSince / 3600000);
      const mins = Math.floor((timeSince % 3600000) / 60000);
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      const canResolve = pick.createdBy === m.sender || pick.createdBy === 'TELEGRAM_BRIDGE';
      const resolveIndicator = canResolve ? '🔓' : '🔒';

      msg += `🎫 ${pick.tipsterOriginal} ${resolveIndicator}\n`;
      msg += `   💰 ${pick.units}u | 👥 ${pick.followers.length} | ⏰ ${timeStr}\n`;
      msg += `   🆔 ${pick.id.slice(-8)}\n\n`;
    }

    if (picks.length > 15) {
      msg += `... y ${picks.length - 15} más\n`;
    }

    msg += '\n🔓 = puedes resolver | 🔒 = registrado por otro\n';
    msg += 'Usa /verde o /roja para resolver, /cancelar para void';

    await m.reply(msg);
  }
};

/**
 * Comando /seguir - Seguir un pick
 */
export const seguirPickPlugin: PluginHandler = {
  command: /^(seguir|follow|unirme)$/i,
  tags: ['betting'],
  help: ['seguir - Seguir un pick activo (responde al mensaje)'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const pick = findPickFromContext(db, m.chat, m.quoted?.key.id, text);

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick para seguir.\n\nResponde a un mensaje de pick o usa /pendientes');
    }

    if (pick.status !== 'pending') {
      return m.reply('❌ Este pick ya fue resuelto, no puedes seguirlo.');
    }

    if (pick.followers.includes(m.sender)) {
      return m.reply('❌ Ya estás siguiendo este pick.');
    }

    const success = db.followPick(m.chat, pick.id, m.sender);
    if (!success) {
      return m.reply('❌ No se pudo seguir el pick.');
    }

    await m.reply(
      `✅ Ahora sigues este pick\n\n` +
      `🎫 Tipster: ${pick.tipsterOriginal}\n` +
      `💰 Unidades: ${pick.units}\n` +
      `👥 Total seguidores: ${pick.followers.length + 1}`
    );
  }
};

/**
 * Comando /cancelar - Cancelar un pick (void/push)
 */
export const cancelarPlugin: PluginHandler = {
  command: /^(cancelar|cancel|void|push|anular)$/i,
  tags: ['betting'],
  help: ['cancelar - Cancelar un pick pendiente (void/push, no afecta stats)'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const pick = findPickFromContext(db, m.chat, m.quoted?.key.id, text);

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick pendiente.\n\nPuedes responder a un pick o usar /pendientes para ver los picks activos.');
    }

    if (pick.status !== 'pending') {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      return m.reply(`❌ Este pick ya fue resuelto como ${emoji} ${pick.status.toUpperCase()}, no se puede cancelar.`);
    }

    if (pick.createdBy !== 'TELEGRAM_BRIDGE' && pick.createdBy !== m.sender) {
      return m.reply('❌ Solo quien registró este pick puede cancelarlo.');
    }

    const cancelled = db.cancelPick(m.chat, pick.id, m.sender);
    if (!cancelled) {
      return m.reply('❌ Error al cancelar el pick.');
    }

    await m.reply(
      `🚫 PICK CANCELADO (VOID)\n\n` +
      `🎫 Tipster: ${cancelled.tipsterOriginal}\n` +
      `💰 Unidades: ${cancelled.units} (devueltas)\n` +
      `👥 Seguidores: ${cancelled.followers.length}\n\n` +
      `Este pick no afecta las estadísticas.`
    );
  }
};

export default [pickPlugin, verdePlugin, rojaPlugin, pendientesPlugin, seguirPickPlugin, cancelarPlugin];
