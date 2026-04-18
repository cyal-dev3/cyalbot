/**
 * 🎫 Plugin de Picks - Sistema de Betting CYALTRONIC
 * Comandos para registrar y gestionar picks de tipsters
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { extractTipsterNameLegacy } from '../lib/betting-parser.js';

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
      return m.reply('❌ El sistema de betting no está habilitado en este grupo.\nUsa */betting on* para activarlo.');
    }

    // Verificar que hay un mensaje citado
    if (!m.quoted) {
      return m.reply('❌ Debes responder a un mensaje de tipster para registrar el pick.\n\n_Busca un mensaje con 🎫 y responde con /pick_');
    }

    const quotedText = m.quoted.text || '';

    // Buscar tipster en el mensaje citado (#Nombre o 🎫 Nombre para compatibilidad)
    const tipsterName = extractTipsterNameLegacy(quotedText);
    if (!tipsterName) {
      return m.reply('❌ El mensaje citado no contiene un tipster válido.\n\n_Busca un mensaje que comience con #NombreTipster_');
    }

    // Parsear unidades (default 1)
    let units = 1;
    if (text) {
      const parsedUnits = parseFloat(text);
      if (!isNaN(parsedUnits) && parsedUnits >= 0.1 && parsedUnits <= 100) {
        units = parsedUnits;
      } else if (text.trim()) {
        return m.reply('❌ Las unidades deben ser un número entre 0.1 y 100.');
      }
    }

    // Verificar si ya existe un pick PENDIENTE con este messageId del mismo tipster
    // Permite: picks de diferentes tipsters del mismo mensaje, o re-registrar si el anterior ya fue resuelto
    const normalizedTipster = db.normalizeTipsterName(tipsterName);
    if (m.quoted.key.id) {
      const existingPick = db.getPickByMessageId(m.chat, m.quoted.key.id);
      if (existingPick && existingPick.tipster === normalizedTipster && existingPick.status === 'pending') {
        return m.reply(`❌ Este pick ya está registrado y pendiente.\n\n🎫 *${existingPick.tipsterOriginal}*\n💰 Unidades: ${existingPick.units}\n🆔 \`${existingPick.id.slice(-8)}\`\n\n_Usa /verde o /roja para resolverlo primero._`);
      }
    }

    // Registrar el pick
    const pick = db.registerPick(m.chat, {
      tipster: normalizedTipster,
      tipsterOriginal: tipsterName,
      description: quotedText.substring(0, 500),
      units,
      status: 'pending',
      createdAt: Date.now(),
      createdBy: m.sender,
      followers: [m.sender], // El que registra también sigue
      messageId: m.quoted.key.id || undefined
    });

    // Actualizar stats del usuario
    const userBetting = db.getUserBetting(m.sender);
    userBetting.stats.totalFollowed++;

    // Auto-seguir al tipster para recibir notificaciones futuras
    const userBettingAfter = db.getUserBetting(m.sender);
    const alreadyFollowing = userBettingAfter.favoriteTipsters.includes(db.normalizeTipsterName(tipsterName));
    const autoFollowed = !alreadyFollowing ? db.followTipster(m.chat, tipsterName, m.sender) : false;

    const tipster = db.getTipster(m.chat, tipsterName);
    const record = tipster ? `${tipster.wins}W - ${tipster.losses}L` : 'Nuevo tipster';

    let followNote = '';
    if (autoFollowed) {
      followNote = '\n_🔔 Auto-seguido a este tipster._';
    } else if (!alreadyFollowing && userBettingAfter.favoriteTipsters.length >= 20) {
      followNote = '\n_ℹ️ No se agregó a favoritos (límite 20)._';
    }

    await m.reply(
      `✅ *PICK REGISTRADO*\n\n` +
      `🎫 *Tipster:* ${tipsterName}\n` +
      `📊 *Record:* ${record}\n` +
      `💰 *Unidades:* ${units}\n` +
      `🆔 *ID:* \`${pick.id.slice(-8)}\`\n\n` +
      `_Usa /verde o /roja para marcar el resultado_` +
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
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    let pick;

    // Si hay mensaje citado, buscar ese pick
    if (m.quoted && m.quoted.key.id) {
      pick = db.getPickByMessageId(m.chat, m.quoted.key.id);
    }

    // Si no hay citado o no se encontró, buscar por ID o el último pendiente
    if (!pick) {
      if (text) {
        // Buscar por ID parcial
        const pendingPicks = db.getPendingPicks(m.chat);
        pick = pendingPicks.find(p => p.id.endsWith(text) || p.id.includes(text));

        if (!pick) {
          // Intentar buscar por nombre de tipster
          pick = db.getLastPendingPick(m.chat, text);
        }
      } else {
        // Obtener el último pick pendiente
        pick = db.getLastPendingPick(m.chat);
      }
    }

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick pendiente.\n\n_Puedes responder a un pick o usar /pendientes para ver los picks activos._');
    }

    if (pick.status !== 'pending') {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      return m.reply(`❌ Este pick ya fue resuelto como ${emoji} ${pick.status.toUpperCase()}`);
    }

    // Verificar que solo el creador del pick pueda resolverlo
    // (excepto si fue creado por TELEGRAM_BRIDGE, en ese caso cualquiera puede)
    if (pick.createdBy !== 'TELEGRAM_BRIDGE' && pick.createdBy !== m.sender) {
      return m.reply('❌ Solo quien registró este pick puede marcarlo como ganado.');
    }

    // Resolver el pick
    const resolved = db.resolvePick(m.chat, pick.id, true, m.sender);
    if (!resolved) {
      return m.reply('❌ Error al resolver el pick.');
    }

    const tipster = db.getTipster(m.chat, resolved.tipsterOriginal);
    const winrate = tipster ? ((tipster.wins / (tipster.wins + tipster.losses)) * 100).toFixed(1) : '0';
    const streak = tipster?.currentStreak || 0;
    const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '';

    await m.reply(
      `✅ *PICK GANADO*\n\n` +
      `🎫 *Tipster:* ${resolved.tipsterOriginal}\n` +
      `💰 *Unidades:* +${resolved.units}\n` +
      `📊 *Nuevo record:* ${tipster?.wins}W - ${tipster?.losses}L (${winrate}%)\n` +
      `${streakEmoji} *Racha:* ${streak > 0 ? '+' : ''}${streak}\n` +
      `👥 *Seguidores:* ${resolved.followers.length}`
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
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    let pick;

    // Si hay mensaje citado, buscar ese pick
    if (m.quoted && m.quoted.key.id) {
      pick = db.getPickByMessageId(m.chat, m.quoted.key.id);
    }

    // Si no hay citado o no se encontró, buscar por ID o el último pendiente
    if (!pick) {
      if (text) {
        const pendingPicks = db.getPendingPicks(m.chat);
        pick = pendingPicks.find(p => p.id.endsWith(text) || p.id.includes(text));

        if (!pick) {
          pick = db.getLastPendingPick(m.chat, text);
        }
      } else {
        pick = db.getLastPendingPick(m.chat);
      }
    }

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick pendiente.\n\n_Puedes responder a un pick o usar /pendientes para ver los picks activos._');
    }

    if (pick.status !== 'pending') {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      return m.reply(`❌ Este pick ya fue resuelto como ${emoji} ${pick.status.toUpperCase()}`);
    }

    // Verificar que solo el creador del pick pueda resolverlo
    // (excepto si fue creado por TELEGRAM_BRIDGE, en ese caso cualquiera puede)
    if (pick.createdBy !== 'TELEGRAM_BRIDGE' && pick.createdBy !== m.sender) {
      return m.reply('❌ Solo quien registró este pick puede marcarlo como perdido.');
    }

    // Resolver el pick
    const resolved = db.resolvePick(m.chat, pick.id, false, m.sender);
    if (!resolved) {
      return m.reply('❌ Error al resolver el pick.');
    }

    const tipster = db.getTipster(m.chat, resolved.tipsterOriginal);
    const winrate = tipster ? ((tipster.wins / (tipster.wins + tipster.losses)) * 100).toFixed(1) : '0';
    const streak = tipster?.currentStreak || 0;
    const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '';

    await m.reply(
      `❌ *PICK PERDIDO*\n\n` +
      `🎫 *Tipster:* ${resolved.tipsterOriginal}\n` +
      `💰 *Unidades:* -${resolved.units}\n` +
      `📊 *Nuevo record:* ${tipster?.wins}W - ${tipster?.losses}L (${winrate}%)\n` +
      `${streakEmoji} *Racha:* ${streak > 0 ? '+' : ''}${streak}\n` +
      `👥 *Seguidores:* ${resolved.followers.length}`
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
        ? `📋 No hay picks pendientes de *${text}*`
        : '📋 No hay picks pendientes en este momento.'
      );
    }

    let msg = `📋 *PICKS PENDIENTES* (${picks.length})\n`;
    msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';

    for (const pick of picks.slice(0, 15)) {
      const timeSince = Date.now() - pick.createdAt;
      const hours = Math.floor(timeSince / 3600000);
      const mins = Math.floor((timeSince % 3600000) / 60000);
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

      // Indicar si el usuario actual puede resolver este pick
      const canResolve = pick.createdBy === m.sender || pick.createdBy === 'TELEGRAM_BRIDGE';
      const resolveIndicator = canResolve ? '🔓' : '🔒';

      msg += `🎫 *${pick.tipsterOriginal}* ${resolveIndicator}\n`;
      msg += `   💰 ${pick.units}u | 👥 ${pick.followers.length} | ⏰ ${timeStr}\n`;
      msg += `   🆔 \`${pick.id.slice(-8)}\`\n\n`;
    }

    if (picks.length > 15) {
      msg += `_... y ${picks.length - 15} más_\n`;
    }

    msg += '\n🔓 = puedes resolver | 🔒 = registrado por otro\n';
    msg += '_Usa /verde o /roja para resolver, /cancelar para void_';

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

    let pick;

    // Si hay mensaje citado, buscar ese pick
    if (m.quoted && m.quoted.key.id) {
      pick = db.getPickByMessageId(m.chat, m.quoted.key.id);
    }

    // Si no, buscar el último o por nombre de tipster
    if (!pick) {
      if (text) {
        pick = db.getLastPendingPick(m.chat, text);
      } else {
        pick = db.getLastPendingPick(m.chat);
      }
    }

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick para seguir.\n\n_Responde a un mensaje de pick o usa /pendientes_');
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
      `✅ *Ahora sigues este pick*\n\n` +
      `🎫 *Tipster:* ${pick.tipsterOriginal}\n` +
      `💰 *Unidades:* ${pick.units}\n` +
      `👥 *Total seguidores:* ${pick.followers.length + 1}`
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

    let pick;

    // Si hay mensaje citado, buscar ese pick
    if (m.quoted && m.quoted.key.id) {
      pick = db.getPickByMessageId(m.chat, m.quoted.key.id);
    }

    // Si no hay citado o no se encontró, buscar por ID o el último pendiente
    if (!pick) {
      if (text) {
        const pendingPicks = db.getPendingPicks(m.chat);
        pick = pendingPicks.find(p => p.id.endsWith(text) || p.id.includes(text));

        if (!pick) {
          pick = db.getLastPendingPick(m.chat, text);
        }
      } else {
        pick = db.getLastPendingPick(m.chat);
      }
    }

    if (!pick) {
      return m.reply('❌ No se encontró ningún pick pendiente.\n\n_Puedes responder a un pick o usar /pendientes para ver los picks activos._');
    }

    if (pick.status !== 'pending') {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      return m.reply(`❌ Este pick ya fue resuelto como ${emoji} ${pick.status.toUpperCase()}, no se puede cancelar.`);
    }

    // Verificar que solo el creador del pick pueda cancelarlo
    if (pick.createdBy !== 'TELEGRAM_BRIDGE' && pick.createdBy !== m.sender) {
      return m.reply('❌ Solo quien registró este pick puede cancelarlo.');
    }

    // Cancelar el pick
    const cancelled = db.cancelPick(m.chat, pick.id, m.sender);
    if (!cancelled) {
      return m.reply('❌ Error al cancelar el pick.');
    }

    await m.reply(
      `🚫 *PICK CANCELADO (VOID)*\n\n` +
      `🎫 *Tipster:* ${cancelled.tipsterOriginal}\n` +
      `💰 *Unidades:* ${cancelled.units} (devueltas)\n` +
      `👥 *Seguidores:* ${cancelled.followers.length}\n\n` +
      `_Este pick no afecta las estadísticas._`
    );
  }
};

export default [pickPlugin, verdePlugin, rojaPlugin, pendientesPlugin, seguirPickPlugin, cancelarPlugin];
