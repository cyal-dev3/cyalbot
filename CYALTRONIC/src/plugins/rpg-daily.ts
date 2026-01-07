/**
 * 🎁 Plugin Daily - CYALTRONIC
 * Recompensa diaria que se puede reclamar cada 2 horas
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, pickRandom } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits, getRoleByLevel } from '../types/user.js';

export const dailyPlugin: PluginHandler = {
  command: /^(daily|claim|reclamar|regalo|diario)$/i,
  tags: ['rpg'],
  help: ['daily - Reclamar recompensa diaria (una vez al día)'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar registro
    if (!user.registered) {
      return m.reply(CONFIG.messages.notRegistered);
    }

    // Obtener beneficios de rango
    const rankBenefits = getRankBenefits(user.level);
    const userRank = getRoleByLevel(user.level);

    // Verificar cooldown (con reducción por rango)
    const now = Date.now();
    const baseCooldown = CONFIG.cooldowns.daily;
    const cooldownReduction = rankBenefits.cooldownReduction / 100;
    const cooldown = Math.floor(baseCooldown * (1 - cooldownReduction));
    const timeSinceLastClaim = now - user.lastclaim;

    if (timeSinceLastClaim < cooldown) {
      const remaining = cooldown - timeSinceLastClaim;
      let cooldownMsg = `${EMOJI.time} *¡Recompensa no disponible!*\n\n` +
        `${EMOJI.warning} Ya reclamaste tu regalo.\n` +
        `${EMOJI.info} Vuelve en: *${msToTime(remaining)}*\n\n` +
        `${EMOJI.star} Mientras tanto puedes usar:\n` +
        `• *${usedPrefix}work* - Trabajar por XP\n` +
        `• *${usedPrefix}perfil* - Ver tu progreso`;

      if (rankBenefits.cooldownReduction > 0) {
        cooldownMsg += `\n\n🎖️ _Tu rango reduce cooldowns -${rankBenefits.cooldownReduction}%_`;
      }

      return m.reply(cooldownMsg);
    }

    // Generar recompensas aleatorias base
    const rewards = CONFIG.rpg.dailyRewards;
    const baseExpReward = pickRandom(rewards.exp);
    const baseMoneyReward = pickRandom(rewards.money);
    const basePotionReward = pickRandom(rewards.potion);
    const baseDiamondReward = pickRandom(rewards.diamonds);

    // Aplicar bonus de rango a las recompensas
    const dailyMultiplier = 1 + (rankBenefits.dailyBonus / 100);
    const expReward = Math.floor(baseExpReward * dailyMultiplier);
    const moneyReward = Math.floor(baseMoneyReward * dailyMultiplier);
    const potionReward = Math.floor(basePotionReward * (1 + rankBenefits.dailyBonus / 200)); // Pociones +50% del bonus
    const diamondReward = Math.floor(baseDiamondReward * (1 + rankBenefits.dailyBonus / 150)); // Diamantes +66% del bonus

    // Calcular bonus de rango
    const rankExpBonus = expReward - baseExpReward;
    const rankMoneyBonus = moneyReward - baseMoneyReward;

    // Calcular streak (días consecutivos) - Feature bonus
    const lastClaimDate = new Date(user.lastclaim).toDateString();
    const yesterdayDate = new Date(Date.now() - 86400000).toDateString();

    let streakBonus = 0;
    let diamondStreakBonus = 0;
    let streakMessage = '';

    // Si reclamó ayer, bonus de racha
    if (lastClaimDate === yesterdayDate) {
      streakBonus = Math.floor(expReward * 0.1); // 10% bonus EXP
      diamondStreakBonus = Math.floor(diamondReward * 0.5); // 50% bonus diamantes
      streakMessage = `\n${EMOJI.fire} *Bonus de racha:* +${formatNumber(streakBonus)} ${EMOJI.exp} | +${diamondStreakBonus} 💎`;
    }

    // Aplicar recompensas
    const totalExp = expReward + streakBonus;
    const totalDiamonds = diamondReward + diamondStreakBonus;

    db.updateUser(m.sender, {
      exp: user.exp + totalExp,
      money: user.money + moneyReward,
      potion: user.potion + potionReward,
      limit: user.limit + totalDiamonds,
      lastclaim: now
    });

    // Mensaje de bonus de rango
    let rankBonusMsg = '';
    if (rankBenefits.dailyBonus > 0) {
      rankBonusMsg = `\n│  🎖️ Bonus rango (+${rankBenefits.dailyBonus}%):\n` +
        `│     +${formatNumber(rankExpBonus)} XP | +${formatNumber(rankMoneyBonus)} 💰`;
    }

    // Calcular horas del próximo daily
    const nextDailyHours = Math.floor(cooldown / 3600000);

    // Mensaje de recompensa
    await m.reply(
      `${EMOJI.gift}${EMOJI.sparkles} *¡RECOMPENSA DIARIA!* ${EMOJI.sparkles}${EMOJI.gift}\n\n` +
      `${EMOJI.success} *¡Has reclamado tu regalo, ${user.name}!*\n` +
      `🎖️ Rango: ${userRank}\n\n` +
      `╭═══════════════════════════╮\n` +
      `│  ${EMOJI.star} *RECOMPENSAS*\n` +
      `├───────────────────────────\n` +
      `│  +${formatNumber(expReward)} ${EMOJI.exp} Experiencia\n` +
      `│  +${formatNumber(moneyReward)} ${EMOJI.coin} Monedas\n` +
      `│  +${potionReward} ${EMOJI.potion} Pociones\n` +
      `│  +${diamondReward} 💎 Diamantes${rankBonusMsg}\n` +
      `╰═══════════════════════════╯${streakMessage}\n\n` +
      `${EMOJI.time} Próximo regalo en: *${nextDailyHours} horas*\n\n` +
      `${EMOJI.info} *Tu nuevo balance:*\n` +
      `├ ${EMOJI.exp} EXP Total: *${formatNumber(user.exp + totalExp)}*\n` +
      `├ ${EMOJI.coin} Monedas: *${formatNumber(user.money + moneyReward)}*\n` +
      `├ ${EMOJI.potion} Pociones: *${user.potion + potionReward}*\n` +
      `╰ 💎 Diamantes: *${formatNumber(user.limit + totalDiamonds)}*\n\n` +
      `${EMOJI.level} ¿Tienes suficiente XP? Usa *${usedPrefix}nivel* para subir.\n` +
      `💎 Usa */tienda diamantes* para gastar tus diamantes.`
    );
  }
};

export default dailyPlugin;
