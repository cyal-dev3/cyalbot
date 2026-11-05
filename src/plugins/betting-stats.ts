/**
 * Estadísticas del sistema de betting: tipster, ranking, historial, estado y limpieza.
 */

import type { PluginHandler } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { BETTING_SEPARATOR, formatRecord, formatStreak, requireBetting, signed, tipsterMetrics } from '../lib/betting-parser.js';

export const tipstatsPlugin: PluginHandler = {
  command: ['tipstats', 'statstipster', 'tipsterstat'],
  tags: ['betting'],
  description: 'Estadísticas de un tipster',
  help: ['tipstats <nombre> - Ver estadísticas de un tipster'],
  usage: ['tipstats Tipster1'],
  group: true,

  handler: async (ctx) => {
    const { m, text, usedPrefix } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    if (!text.trim()) return m.reply(`¿De quién? *${usedPrefix}tipstats NombreTipster*`);
    const tipster = store.getTipster(m.chat, text);
    if (!tipster) return m.reply(`❌ No conozco al tipster *${text.trim()}*. Mira *${usedPrefix}rankingtipsters*.`);

    const metrics = tipsterMetrics(tipster);
    let lastPickStr = 'Nunca';
    if (tipster.lastPickDate > 0) {
      const diff = Date.now() - tipster.lastPickDate;
      const days = Math.floor(diff / 86_400_000);
      const hours = Math.floor((diff % 86_400_000) / 3_600_000);
      lastPickStr = days > 0 ? `Hace ${days}d ${hours}h` : hours > 0 ? `Hace ${hours}h` : 'Hace menos de 1h';
    }

    await m.reply(
      `🎫 *${tipster.name}*\n${BETTING_SEPARATOR}\n\n` +
      `📊 *Record*\n` +
      `  ✅ Victorias: ${tipster.wins}\n  ❌ Derrotas: ${tipster.losses}\n  ⏳ Pendientes: ${tipster.pending}\n  📈 Winrate: ${metrics.winrate.toFixed(2)}%\n\n` +
      `💰 *Unidades*\n` +
      `  Apostadas: ${tipster.totalUnits.toFixed(1)}u\n  Ganadas: +${tipster.wonUnits.toFixed(1)}u\n  Perdidas: -${tipster.lostUnits.toFixed(1)}u\n` +
      `  Profit: ${signed(metrics.profit, 2)}u\n  ROI: ${signed(metrics.roi, 2)}%\n\n` +
      `*Rachas*\n  Actual: ${formatStreak(metrics.streak)}\n  🏆 Mejor: +${tipster.bestStreak}\n  💀 Peor: ${tipster.worstStreak}\n\n` +
      `👥 Seguidores: ${tipster.followers.length}\n⏰ Último pick: ${lastPickStr}`,
    );
  },
};

const SORT_KEYS: Record<string, 'winrate' | 'roi' | 'wins' | 'streak'> = {
  winrate: 'winrate', roi: 'roi', profit: 'roi', wins: 'wins', victorias: 'wins', streak: 'streak', racha: 'streak',
};
const SORT_LABELS = { winrate: 'WINRATE', roi: 'ROI', wins: 'VICTORIAS', streak: 'MEJOR RACHA' };

export const rankingTipstersPlugin: PluginHandler = {
  command: ['rankingtipsters', 'toptipsters'],
  tags: ['betting'],
  description: 'Ranking de tipsters del grupo',
  help: ['rankingtipsters [winrate|roi|wins|streak] - Ranking de tipsters'],
  usage: ['rankingtipsters', 'rankingtipsters roi'],
  group: true,

  handler: async (ctx) => {
    const { m, text, usedPrefix } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    const sortBy = SORT_KEYS[text.trim().toLowerCase()] ?? 'winrate';
    const tipsters = store.getTipsterRanking(m.chat, sortBy, 15);
    if (tipsters.length === 0) {
      return m.reply('📊 Aún no hay tipsters con picks resueltos.');
    }

    const medals = ['🥇', '🥈', '🥉'];
    let msg = `🏆 *RANKING DE TIPSTERS* · ${SORT_LABELS[sortBy]}\n${BETTING_SEPARATOR}\n\n`;
    tipsters.forEach((tipster, index) => {
      const metrics = tipsterMetrics(tipster);
      msg += `${medals[index] ?? `${index + 1}.`} *${tipster.name}*\n`;
      msg += `   ${formatRecord(tipster)} · ROI ${signed(metrics.roi)}% · ${formatStreak(metrics.streak)}\n`;
    });
    msg += `\n_${usedPrefix}rankingtipsters winrate|roi|wins|streak_`;
    await m.reply(msg);
  },
};

export const historialPlugin: PluginHandler = {
  command: ['historial', 'history', 'ultimos'],
  tags: ['betting'],
  description: 'Últimos picks resueltos',
  help: ['historial [tipster] - Ver últimos picks resueltos'],
  usage: ['historial', 'historial Tipster1'],
  group: true,

  handler: async (ctx) => {
    const { m, text } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    const filter = text.trim() || undefined;
    const picks = store.getPickHistory(m.chat, filter, 20);
    if (picks.length === 0) {
      return m.reply(filter ? `📋 No hay historial de ${filter}.` : '📋 Todavía no hay picks resueltos.');
    }

    let msg = filter ? `📋 *HISTORIAL DE ${filter.toUpperCase()}*\n` : `📋 *ÚLTIMOS PICKS RESUELTOS*\n`;
    msg += `${BETTING_SEPARATOR}\n\n`;
    for (const pick of picks) {
      const date = new Date(pick.resolvedAt || pick.createdAt);
      msg += `${pick.status === 'won' ? '✅' : '❌'} ${pick.tipsterOriginal} · ${pick.units}u · ${date.getDate()}/${date.getMonth() + 1}\n`;
    }
    const won = picks.filter((p) => p.status === 'won').length;
    const lost = picks.length - won;
    msg += `\n${BETTING_SEPARATOR}\n📊 Últimos ${picks.length}: ${won}W-${lost}L (${((won / picks.length) * 100).toFixed(1)}%)`;
    await m.reply(msg);
  },
};

export const bettingPlugin: PluginHandler = {
  command: ['betting', 'apuestas'],
  tags: ['betting'],
  description: 'Activa o desactiva el sistema de betting (admin)',
  help: ['betting on|off|auto|status - Activar, desactivar o configurar el sistema de betting (admin)'],
  usage: ['betting on', 'betting auto', 'betting status'],
  group: true,
  admin: true,

  handler: async ({ m, args, usedPrefix }) => {
    const store = getDatabase().betting;
    const system = store.getBettingSystem(m.chat);

    switch (args[0]?.toLowerCase()) {
      case 'on':
      case 'activar':
      case 'enable': {
        if (system.enabled) return m.reply('✅ El sistema de betting ya está activado.');
        store.updateBettingSystem(m.chat, { enabled: true });
        return m.reply(
          `✅ *Sistema de betting activado*\n\n` +
          `• *${usedPrefix}pick* respondiendo a un mensaje que empiece con #Tipster\n` +
          `• *${usedPrefix}verde* / *${usedPrefix}roja* para resolver picks\n` +
          `• *${usedPrefix}pendientes* para ver los activos\n` +
          `• *${usedPrefix}tipster seguir <nombre>* para recibir avisos\n` +
          `• *${usedPrefix}tipstats* y *${usedPrefix}rankingtipsters* para estadísticas\n\n` +
          `Los mensajes del puente de Telegram que empiecen con #Tipster se detectan solos; con *${usedPrefix}betting auto* además se registran como picks.`,
        );
      }
      case 'off':
      case 'desactivar':
      case 'disable': {
        if (!system.enabled) return m.reply('El sistema de betting ya estaba desactivado.');
        store.updateBettingSystem(m.chat, { enabled: false });
        return m.reply('❌ Sistema de betting desactivado.');
      }
      case 'auto':
      case 'autoregistro': {
        const autoRegister = !system.autoRegister;
        store.updateBettingSystem(m.chat, { autoRegister });
        return m.reply(autoRegister
          ? '✅ Auto-registro activado: los picks con imagen que lleguen de Telegram se registran solos.'
          : `❌ Auto-registro desactivado: los picks se registran a mano con *${usedPrefix}pick*.`);
      }
      default: {
        const pending = system.picks.filter((p) => p.status === 'pending').length;
        return m.reply(
          `🎫 *ESTADO DEL BETTING*\n${BETTING_SEPARATOR}\n\n` +
          `Estado: ${system.enabled ? '✅ Activo' : '❌ Inactivo'}\n` +
          `Auto-registro: ${system.autoRegister ? '✅ Sí' : '❌ No'}\n\n` +
          `Tipsters: ${Object.keys(system.tipsters).length}\n` +
          `Picks: ${system.picks.length} (${pending} pendientes, ${system.picks.length - pending} resueltos)\n\n` +
          `*${usedPrefix}betting on|off* · *${usedPrefix}betting auto*`,
        );
      }
    }
  },
};

export const bettingStatsPlugin: PluginHandler = {
  command: ['bettingstats', 'statsbet', 'statsbetting'],
  tags: ['betting'],
  description: 'Estadísticas globales del betting del grupo',
  help: ['bettingstats - Estadísticas globales del sistema de betting'],
  usage: ['bettingstats'],
  group: true,

  handler: async (ctx) => {
    const { m } = ctx;
    const system = await requireBetting(ctx);
    if (!system) return;

    const tipsters = Object.values(system.tipsters);
    const picks = system.picks;
    const pendingPicks = picks.filter((p) => p.status === 'pending').length;
    const wonPicks = picks.filter((p) => p.status === 'won').length;
    const lostPicks = picks.filter((p) => p.status === 'lost').length;
    const resolvedPicks = wonPicks + lostPicks;
    const globalWinrate = resolvedPicks > 0 ? ((wonPicks / resolvedPicks) * 100).toFixed(2) : '0.00';

    const totalUnits = tipsters.reduce((sum, t) => sum + t.totalUnits, 0);
    const wonUnits = tipsters.reduce((sum, t) => sum + t.wonUnits, 0);
    const lostUnits = tipsters.reduce((sum, t) => sum + t.lostUnits, 0);
    const profitUnits = wonUnits - lostUnits;
    const globalRoi = totalUnits > 0 ? (profitUnits / totalUnits) * 100 : 0;

    const ranked = tipsters.filter((t) => t.wins + t.losses >= 3).sort((a, b) => tipsterMetrics(b).winrate - tipsterMetrics(a).winrate);
    const best = ranked[0];
    const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;

    let msg = `📊 *ESTADÍSTICAS DEL BETTING*\n${BETTING_SEPARATOR}\n\n`;
    msg += `🎫 *Tipsters*: ${tipsters.length} (${ranked.length} con 3+ picks)\n`;
    if (best) msg += `  🏆 Mejor: ${best.name} (${tipsterMetrics(best).winrate.toFixed(0)}%)\n`;
    if (worst) msg += `  💀 Peor: ${worst.name} (${tipsterMetrics(worst).winrate.toFixed(0)}%)\n`;
    msg += `\n📈 *Picks*: ${picks.length}\n  ✅ ${wonPicks} · ❌ ${lostPicks} · ⏳ ${pendingPicks} · Winrate ${globalWinrate}%\n`;
    msg += `\n💰 *Unidades*\n  Apostadas: ${totalUnits.toFixed(1)}u · Ganadas: +${wonUnits.toFixed(1)}u · Perdidas: -${lostUnits.toFixed(1)}u\n`;
    msg += `  Profit: ${signed(profitUnits)}u · ROI: ${signed(globalRoi, 2)}%`;
    await m.reply(msg);
  },
};

export const clearPicksPlugin: PluginHandler = {
  command: ['clearpicks', 'borrarpicks', 'clearbets'],
  tags: ['betting'],
  description: 'Elimina todos los picks pendientes (admin)',
  help: ['clearpicks - Eliminar todos los picks pendientes (admin)'],
  usage: ['clearpicks'],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const { m } = ctx;
    const store = getDatabase().betting;
    if (!(await requireBetting(ctx))) return;

    const count = store.clearPendingPicks(m.chat);
    if (count === 0) return m.reply('📋 No había picks pendientes.');
    await m.reply(`🗑️ Eliminados ${count} pick${count === 1 ? '' : 's'} pendiente${count === 1 ? '' : 's'}. Las estadísticas de los tipsters no cambian.`);
  },
};

export default [tipstatsPlugin, rankingTipstersPlugin, historialPlugin, bettingPlugin, bettingStatsPlugin, clearPicksPlugin];
