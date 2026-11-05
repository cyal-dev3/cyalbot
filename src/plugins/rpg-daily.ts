import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, pickRandom, checkCooldown } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits, getRoleByLevel } from '../types/user.js';
import { grantRewards, replyCooldown, formatReward } from '../lib/rpg-actions.js';

/** Días de racha a partir de los cuales el bonus deja de crecer */
export const STREAK_MAX_DAYS = 7;
/** Bonus de XP y dinero por cada día de racha (%) */
export const STREAK_BONUS_PER_DAY = 5;

/**
 * Calcula la racha tras un reclamo: continúa si el anterior fue hace menos de
 * dos cooldowns (un día de margen), si no vuelve a 1.
 */
export function nextStreak(previousStreak: number, lastClaim: number, now: number, cooldown: number): number {
  if (lastClaim <= 0 || now - lastClaim >= cooldown * 2) return 1;
  return Math.max(1, (previousStreak || 0) + 1);
}

export function streakBonusPercent(streak: number): number {
  return Math.min(streak, STREAK_MAX_DAYS) * STREAK_BONUS_PER_DAY;
}

export const dailyPlugin: PluginHandler = {
  command: /^(daily|claim|reclamar|regalo|diario)$/i,
  tags: ['rpg'],
  help: ['daily - Reclamar recompensa diaria (racha con bonus creciente hasta 7 días)'],
  usage: ['daily'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();
    const benefits = getRankBenefits(user.level);

    const cd = checkCooldown(user.lastClaim, CONFIG.cooldowns.daily, benefits.cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [
        { cmd: 'work', desc: 'Trabajar por XP' },
        { cmd: 'minar', desc: 'Minar minerales' },
        { cmd: 'perfil', desc: 'Ver tu progreso' }
      ]);
    }

    const rewards = CONFIG.rpg.dailyRewards;
    const streak = nextStreak(user.dailyStreak ?? 0, user.lastClaim, now, cd.effectiveCooldown);
    const streakPct = streakBonusPercent(streak);
    const dailyMultiplier = (1 + benefits.dailyBonus / 100) * (1 + streakPct / 100);

    const baseDiamonds = pickRandom(rewards.diamonds);
    const potions = Math.floor(pickRandom(rewards.potion) * (1 + benefits.dailyBonus / 200));
    const diamonds = Math.floor(baseDiamonds * (1 + benefits.dailyBonus / 150)) + Math.min(streak, STREAK_MAX_DAYS);

    db.updateUser(m.sender, { lastClaim: now, dailyStreak: streak });

    const result = grantRewards(
      db,
      m.sender,
      {
        exp: pickRandom(rewards.exp),
        money: pickRandom(rewards.money),
        diamonds,
        potions,
        questObjectives: [{ objective: 'daily', amount: 1 }]
      },
      { source: 'daily', multiplier: dailyMultiplier, rank: false, now }
    );

    const lines = [
      `+${formatNumber(result.exp)} ${EMOJI.exp} XP`,
      `+${formatNumber(result.money)} ${EMOJI.coin} monedas`,
      `+${result.potions} ${EMOJI.potion} pociones`,
      `+${result.diamonds} 💎 diamantes`,
      `${EMOJI.fire} Racha: *${streak} día${streak > 1 ? 's' : ''}* (+${streakPct}%)`
    ];
    if (benefits.dailyBonus > 0) lines.push(`🎖️ Rango ${getRoleByLevel(user.level)}: +${benefits.dailyBonus}%`);
    lines.push(...result.lines);

    const fresh = db.getUser(m.sender);
    await m.reply(formatReward(ctx, `${EMOJI.gift} Recompensa diaria`, lines, {
      intro: `${EMOJI.success} ¡Has reclamado tu regalo, *${fresh.name}*!`,
      footer: `${EMOJI.coin} Monedas: *${formatNumber(fresh.money)}* · 💎 *${formatNumber(fresh.limit)}* · ${EMOJI.level} Nivel *${fresh.level}*\n` +
        `${EMOJI.time} Próximo regalo en *${Math.floor(cd.effectiveCooldown / 3600000)} horas*. Usa *${usedPrefix}misiones* para ver tus misiones.`
    }));
  }
};

export default dailyPlugin;
