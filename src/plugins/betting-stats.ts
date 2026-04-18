/**
 * 📊 Plugin de Estadísticas - Sistema de Betting CYALTRONIC
 * Comandos para ver estadísticas, rankings e historial
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { BETTING_SEPARATOR } from '../lib/betting-parser.js';

/**
 * Comando /tipstats - Stats de un tipster
 */
export const tipstatsPlugin: PluginHandler = {
  command: /^(tipstats|statstipster|tipsterstat)$/i,
  tags: ['betting'],
  help: ['tipstats <nombre> - Ver estadísticas de un tipster'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    if (!text) {
      return m.reply('❌ Debes especificar el nombre del tipster.\n\nEjemplo: /tipstats NombreTipster');
    }

    const tipster = db.getTipster(m.chat, text);

    if (!tipster) {
      return m.reply(`❌ No se encontró el tipster ${text}\n\nUsa /rankingtipsters para ver los tipsters disponibles.`);
    }

    const total = tipster.wins + tipster.losses;
    const winrate = total > 0 ? ((tipster.wins / total) * 100).toFixed(2) : '0.00';
    const roi = tipster.totalUnits > 0
      ? (((tipster.wonUnits - tipster.lostUnits) / tipster.totalUnits) * 100).toFixed(2)
      : '0.00';
    const profitUnits = (tipster.wonUnits - tipster.lostUnits).toFixed(2);

    const streak = tipster.currentStreak;
    const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '➖';
    const streakText = streak > 0 ? `+${streak} (ganando)` : streak < 0 ? `${streak} (perdiendo)` : '0';

    let lastPickStr = 'Nunca';
    if (tipster.lastPickDate > 0) {
      const diff = Date.now() - tipster.lastPickDate;
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      if (days > 0) {
        lastPickStr = `Hace ${days}d ${hours}h`;
      } else if (hours > 0) {
        lastPickStr = `Hace ${hours}h`;
      } else {
        lastPickStr = 'Hace menos de 1h';
      }
    }

    let msg = `🎫 ESTADÍSTICAS DE TIPSTER\n${BETTING_SEPARATOR}\n\n`;
    msg += `📛 ${tipster.name}\n\n`;

    msg += `📊 RECORD\n`;
    msg += `  ✅ Victorias: ${tipster.wins}\n`;
    msg += `  ❌ Derrotas: ${tipster.losses}\n`;
    msg += `  ⏳ Pendientes: ${tipster.pending}\n`;
    msg += `  📈 Winrate: ${winrate}%\n\n`;

    msg += `💰 UNIDADES\n`;
    msg += `  Total apostado: ${tipster.totalUnits.toFixed(1)}u\n`;
    msg += `  Ganadas: +${tipster.wonUnits.toFixed(1)}u\n`;
    msg += `  Perdidas: -${tipster.lostUnits.toFixed(1)}u\n`;
    msg += `  Profit: ${parseFloat(profitUnits) >= 0 ? '+' : ''}${profitUnits}u\n`;
    msg += `  ROI: ${parseFloat(roi) >= 0 ? '+' : ''}${roi}%\n\n`;

    msg += `${streakEmoji} RACHAS\n`;
    msg += `  Actual: ${streakText}\n`;
    msg += `  🏆 Mejor: +${tipster.bestStreak}\n`;
    msg += `  💀 Peor: ${tipster.worstStreak}\n\n`;

    msg += `👥 Seguidores: ${tipster.followers.length}\n`;
    msg += `⏰ Último pick: ${lastPickStr}`;

    await m.reply(msg);
  }
};

/**
 * Comando /rankingtipsters - Top tipsters
 */
export const rankingTipstersPlugin: PluginHandler = {
  command: /^(rankingtipsters|toptipsters|ranking|leaderboard)$/i,
  tags: ['betting'],
  help: ['rankingtipsters [winrate/roi/wins/streak] - Ranking de tipsters'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    let sortBy: 'winrate' | 'roi' | 'wins' | 'streak' = 'winrate';
    const sortArg = text?.toLowerCase();

    if (sortArg === 'roi' || sortArg === 'profit') {
      sortBy = 'roi';
    } else if (sortArg === 'wins' || sortArg === 'victorias') {
      sortBy = 'wins';
    } else if (sortArg === 'streak' || sortArg === 'racha') {
      sortBy = 'streak';
    }

    const tipsters = db.getTipsterRanking(m.chat, sortBy, 15);

    if (tipsters.length === 0) {
      return m.reply('📊 No hay tipsters con historial todavía.\n\nLos tipsters aparecerán aquí cuando tengan picks resueltos.');
    }

    const sortLabels = {
      winrate: 'WINRATE',
      roi: 'ROI',
      wins: 'VICTORIAS',
      streak: 'MEJOR RACHA'
    };

    let msg = `🏆 RANKING DE TIPSTERS\n`;
    msg += `📊 Ordenado por: ${sortLabels[sortBy]}\n`;
    msg += `${BETTING_SEPARATOR}\n\n`;

    const medals = ['🥇', '🥈', '🥉'];

    tipsters.forEach((tipster, index) => {
      const medal = medals[index] || `${index + 1}.`;
      const total = tipster.wins + tipster.losses;
      const winrate = total > 0 ? ((tipster.wins / total) * 100).toFixed(1) : '0.0';
      const roi = tipster.totalUnits > 0
        ? (((tipster.wonUnits - tipster.lostUnits) / tipster.totalUnits) * 100).toFixed(1)
        : '0.0';

      const streak = tipster.currentStreak;
      const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '';

      msg += `${medal} ${tipster.name}\n`;
      msg += `   ${tipster.wins}W-${tipster.losses}L | ${winrate}% | ROI: ${parseFloat(roi) >= 0 ? '+' : ''}${roi}% ${streakEmoji}\n\n`;
    });

    msg += `Usa /rankingtipsters [winrate|roi|wins|streak]`;

    await m.reply(msg);
  }
};

/**
 * Comando /historial - Últimos picks resueltos
 */
export const historialPlugin: PluginHandler = {
  command: /^(historial|history|ultimos)$/i,
  tags: ['betting'],
  help: ['historial [tipster] - Ver últimos picks resueltos'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const picks = db.getPickHistory(m.chat, text || undefined, 20);

    if (picks.length === 0) {
      return m.reply(text
        ? `📋 No hay historial de ${text}`
        : '📋 No hay picks resueltos todavía.'
      );
    }

    let msg = text
      ? `📋 HISTORIAL DE ${text.toUpperCase()}\n`
      : `📋 ÚLTIMOS PICKS RESUELTOS\n`;
    msg += `${BETTING_SEPARATOR}\n\n`;

    for (const pick of picks) {
      const emoji = pick.status === 'won' ? '✅' : '❌';
      const date = new Date(pick.resolvedAt || pick.createdAt);
      const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;

      msg += `${emoji} ${pick.tipsterOriginal} | ${pick.units}u | ${dateStr}\n`;
    }

    const won = picks.filter(p => p.status === 'won').length;
    const lost = picks.filter(p => p.status === 'lost').length;
    const totalResolved = won + lost;
    const winrate = totalResolved > 0 ? ((won / totalResolved) * 100).toFixed(1) : '0.0';

    msg += `\n${BETTING_SEPARATOR}\n`;
    msg += `📊 Últimos ${picks.length}: ${won}W-${lost}L (${winrate}%)`;

    await m.reply(msg);
  }
};

/**
 * Comando /betting - Activar/desactivar sistema (admin)
 */
export const bettingPlugin: PluginHandler = {
  command: /^(betting|apuestas)$/i,
  tags: ['betting'],
  help: ['betting on/off/auto - Activar/desactivar sistema de betting (admin)'],
  group: true,
  admin: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const subcommand = args[0]?.toLowerCase();
    const system = db.getBettingSystem(m.chat);

    switch (subcommand) {
      case 'on':
      case 'activar':
      case 'enable': {
        if (system.enabled) {
          return m.reply('✅ El sistema de betting ya está activado.');
        }
        db.updateBettingSystem(m.chat, { enabled: true });
        await m.reply(
          `✅ Sistema de Betting ACTIVADO\n\n` +
          `Comandos disponibles:\n` +
          `• /pick - Registrar pick\n` +
          `• /verde /roja - Resolver picks\n` +
          `• /pendientes - Ver picks activos\n` +
          `• /tipster - Gestionar favoritos\n` +
          `• /tipstats - Stats de tipster\n` +
          `• /rankingtipsters - Top tipsters\n\n` +
          `Los picks de Telegram con 🎫 serán detectados automáticamente.`
        );
        break;
      }

      case 'off':
      case 'desactivar':
      case 'disable': {
        if (!system.enabled) {
          return m.reply('❌ El sistema de betting ya está desactivado.');
        }
        db.updateBettingSystem(m.chat, { enabled: false });
        await m.reply('❌ Sistema de Betting DESACTIVADO');
        break;
      }

      case 'auto':
      case 'autoregistro': {
        const newValue = !system.autoRegister;
        db.updateBettingSystem(m.chat, { autoRegister: newValue });
        await m.reply(
          newValue
            ? '✅ Auto-registro ACTIVADO\n\nLos picks de Telegram se registrarán automáticamente.'
            : '❌ Auto-registro DESACTIVADO\n\nLos picks deberán registrarse manualmente con /pick.'
        );
        break;
      }

      case 'status':
      case 'estado':
      default: {
        const totalTipsters = Object.keys(system.tipsters).length;
        const totalPicks = system.picks.length;
        const pendingPicks = system.picks.filter(p => p.status === 'pending').length;
        const resolvedPicks = totalPicks - pendingPicks;

        let msg = `🎫 ESTADO DEL SISTEMA DE BETTING\n${BETTING_SEPARATOR}\n\n`;
        msg += `📊 Estado: ${system.enabled ? '✅ Activo' : '❌ Inactivo'}\n`;
        msg += `🤖 Auto-registro: ${system.autoRegister ? '✅ Sí' : '❌ No'}\n\n`;
        msg += `📈 Estadísticas:\n`;
        msg += `  Tipsters: ${totalTipsters}\n`;
        msg += `  Total picks: ${totalPicks}\n`;
        msg += `  Pendientes: ${pendingPicks}\n`;
        msg += `  Resueltos: ${resolvedPicks}\n\n`;
        msg += `Comandos:\n`;
        msg += `• /betting on - Activar\n`;
        msg += `• /betting off - Desactivar\n`;
        msg += `• /betting auto - Toggle auto-registro`;

        await m.reply(msg);
      }
    }
  }
};

/**
 * Comando /bettingstats - Estadísticas globales del sistema
 */
export const bettingStatsPlugin: PluginHandler = {
  command: /^(bettingstats|statsbet|statsbetting)$/i,
  tags: ['betting'],
  help: ['bettingstats - Estadísticas globales del sistema de betting'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const tipsters = Object.values(system.tipsters);
    const picks = system.picks;

    const totalTipsters = tipsters.length;
    const totalPicks = picks.length;
    const pendingPicks = picks.filter(p => p.status === 'pending').length;
    const wonPicks = picks.filter(p => p.status === 'won').length;
    const lostPicks = picks.filter(p => p.status === 'lost').length;
    const resolvedPicks = wonPicks + lostPicks;

    const globalWinrate = resolvedPicks > 0 ? ((wonPicks / resolvedPicks) * 100).toFixed(2) : '0.00';

    let totalUnits = 0;
    let wonUnits = 0;
    let lostUnits = 0;

    for (const tipster of tipsters) {
      totalUnits += tipster.totalUnits;
      wonUnits += tipster.wonUnits;
      lostUnits += tipster.lostUnits;
    }

    const profitUnits = wonUnits - lostUnits;
    const globalRoi = totalUnits > 0 ? ((profitUnits / totalUnits) * 100).toFixed(2) : '0.00';

    const sortedByWinrate = tipsters
      .filter(t => t.wins + t.losses >= 3)
      .sort((a, b) => {
        const wrA = a.wins / (a.wins + a.losses);
        const wrB = b.wins / (b.wins + b.losses);
        return wrB - wrA;
      });

    const bestTipster = sortedByWinrate[0];
    const worstTipster = sortedByWinrate[sortedByWinrate.length - 1];

    let msg = `📊 ESTADÍSTICAS GLOBALES DE BETTING\n${BETTING_SEPARATOR}\n\n`;

    msg += `🎫 TIPSTERS\n`;
    msg += `  Total: ${totalTipsters}\n`;
    msg += `  Con historial: ${sortedByWinrate.length}\n`;
    if (bestTipster) {
      const bestWr = ((bestTipster.wins / (bestTipster.wins + bestTipster.losses)) * 100).toFixed(0);
      msg += `  🏆 Mejor: ${bestTipster.name} (${bestWr}%)\n`;
    }
    if (worstTipster && worstTipster !== bestTipster) {
      const worstWr = ((worstTipster.wins / (worstTipster.wins + worstTipster.losses)) * 100).toFixed(0);
      msg += `  💀 Peor: ${worstTipster.name} (${worstWr}%)\n`;
    }

    msg += `\n📈 PICKS\n`;
    msg += `  Total: ${totalPicks}\n`;
    msg += `  ✅ Ganados: ${wonPicks}\n`;
    msg += `  ❌ Perdidos: ${lostPicks}\n`;
    msg += `  ⏳ Pendientes: ${pendingPicks}\n`;
    msg += `  📊 Winrate: ${globalWinrate}%\n`;

    msg += `\n💰 UNIDADES\n`;
    msg += `  Total apostado: ${totalUnits.toFixed(1)}u\n`;
    msg += `  Ganadas: +${wonUnits.toFixed(1)}u\n`;
    msg += `  Perdidas: -${lostUnits.toFixed(1)}u\n`;
    msg += `  Profit: ${profitUnits >= 0 ? '+' : ''}${profitUnits.toFixed(1)}u\n`;
    msg += `  ROI: ${parseFloat(globalRoi) >= 0 ? '+' : ''}${globalRoi}%`;

    await m.reply(msg);
  }
};

/**
 * Comando /clearpicks - Borrar todos los picks pendientes (admin)
 */
export const clearPicksPlugin: PluginHandler = {
  command: /^(clearpicks|borrarpicks|limpiar picks|clearbets)$/i,
  tags: ['betting'],
  help: ['clearpicks - Eliminar todos los picks pendientes (admin)'],
  group: true,
  admin: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const count = db.clearPendingPicks(m.chat);

    if (count === 0) {
      return m.reply('📋 No había picks pendientes que eliminar.');
    }

    await m.reply(
      `🗑️ PICKS ELIMINADOS\n\n` +
      `Se eliminaron ${count} pick${count === 1 ? '' : 's'} pendiente${count === 1 ? '' : 's'}.\n\n` +
      `Los registros ganados/perdidos y las stats de los tipsters no se modificaron.`
    );
  }
};

export default [tipstatsPlugin, rankingTipstersPlugin, historialPlugin, bettingPlugin, bettingStatsPlugin, clearPicksPlugin];
