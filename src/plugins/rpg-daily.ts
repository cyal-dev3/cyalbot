/**
 * 🎁 Plugin Daily - CYALTRONIC
 * Recompensa diaria que se puede reclamar cada 2 horas
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, pickRandom } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits, getRoleByLevel } from '../types/user.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';

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

    // Verificar modos globales expirados
    checkExpiredModes();

    // Obtener beneficios de rango
    const rankBenefits = getRankBenefits(user.level);
    const userRank = getRoleByLevel(user.level);

    // Verificar cooldown (con reducción por rango)
    const now = Date.now();
    const baseCooldown = CONFIG.cooldowns.daily;
    const cooldownReduction = rankBenefits.cooldownReduction / 100;
    const cooldown = Math.floor(baseCooldown * (1 - cooldownReduction));
    const timeSinceLastClaim = now - user.lastClaim;

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
    const lastClaimDate = new Date(user.lastClaim).toDateString();
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

    // Aplicar multiplicadores de modos globales
    let globalExpBonus = 0;
    let globalMoneyBonus = 0;
    let modeMessages: string[] = [];

    // Bonus Mode
    if (globalModes.bonusMode.active) {
      const bonusExp = Math.floor(expReward * (globalModes.bonusMode.expMultiplier - 1));
      const bonusMoney = Math.floor(moneyReward * (globalModes.bonusMode.moneyMultiplier - 1));
      globalExpBonus += bonusExp;
      globalMoneyBonus += bonusMoney;
      modeMessages.push(`🎁 Modo Bonus: +${bonusExp} XP, +${bonusMoney} 💰`);
    }

    // Chaos Mode
    if (globalModes.chaosMode.active) {
      const chaosExp = Math.floor(expReward * (globalModes.chaosMode.multiplier - 1));
      const chaosMoney = Math.floor(moneyReward * (globalModes.chaosMode.multiplier - 1));
      globalExpBonus += chaosExp;
      globalMoneyBonus += chaosMoney;
      modeMessages.push(`🌀 Modo Caos: +${chaosExp} XP, +${chaosMoney} 💰`);
    }

    // Event Mode
    if (globalModes.eventMode.active) {
      const eventExp = Math.floor(expReward * (globalModes.eventMode.dropMultiplier - 1));
      const eventMoney = Math.floor(moneyReward * (globalModes.eventMode.dropMultiplier - 1));
      globalExpBonus += eventExp;
      globalMoneyBonus += eventMoney;
      modeMessages.push(`🎉 ${globalModes.eventMode.eventName}: +${eventExp} XP, +${eventMoney} 💰`);
    }

    // Aplicar recompensas con bonos globales
    let totalExp = expReward + streakBonus + globalExpBonus;
    let totalMoney = moneyReward + globalMoneyBonus;
    const totalDiamonds = diamondReward + diamondStreakBonus;

    // Verificar si el usuario es esclavo y transferir parte al amo
    let slaveryMessage = '';
    let masterExpCut = 0;
    let masterMoneyCut = 0;
    const SLAVERY_CUT_PERCENT = 50; // 50% va al amo

    if (user.slaveMaster && user.slaveUntil > now) {
      const master = db.getUser(user.slaveMaster);

      // Calcular el corte del amo (50%)
      masterExpCut = Math.floor(totalExp * (SLAVERY_CUT_PERCENT / 100));
      masterMoneyCut = Math.floor(totalMoney * (SLAVERY_CUT_PERCENT / 100));

      // Reducir las ganancias del esclavo
      totalExp -= masterExpCut;
      totalMoney -= masterMoneyCut;

      // Transferir al amo
      if (masterExpCut > 0 || masterMoneyCut > 0) {
        db.updateUser(user.slaveMaster, {
          exp: master.exp + masterExpCut,
          money: master.money + masterMoneyCut
        });

        slaveryMessage = `\n\n⛓️ *ESCLAVITUD ACTIVA*\n` +
          `├ Tu amo *${master.name}* recibió:\n` +
          `│  ${masterExpCut > 0 ? `+${formatNumber(masterExpCut)} ${EMOJI.exp} XP` : ''}` +
          `${masterExpCut > 0 && masterMoneyCut > 0 ? ' | ' : ''}` +
          `${masterMoneyCut > 0 ? `+${formatNumber(masterMoneyCut)} ${EMOJI.coin}` : ''}\n` +
          `╰ _${SLAVERY_CUT_PERCENT}% de tus ganancias_`;
      }
    }

    db.updateUser(m.sender, {
      exp: user.exp + totalExp,
      money: user.money + totalMoney,
      potion: user.potion + potionReward,
      limit: user.limit + totalDiamonds,
      lastClaim: now
    });

    // Mensaje de bonus de rango
    let rankBonusMsg = '';
    if (rankBenefits.dailyBonus > 0) {
      rankBonusMsg = `\n│  🎖️ Bonus rango (+${rankBenefits.dailyBonus}%):\n` +
        `│     +${formatNumber(rankExpBonus)} XP | +${formatNumber(rankMoneyBonus)} 💰`;
    }

    // Mensaje de modos activos
    let modesMsg = '';
    if (modeMessages.length > 0) {
      modesMsg = `\n\n🎮 *BONIFICACIONES ACTIVAS:*\n├ ${modeMessages.join('\n├ ')}`;
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
      `╰═══════════════════════════╯${streakMessage}${slaveryMessage}${modesMsg}\n\n` +
      `${EMOJI.time} Próximo regalo en: *${nextDailyHours} horas*\n\n` +
      `${EMOJI.info} *Tu nuevo balance:*\n` +
      `├ ${EMOJI.exp} EXP Total: *${formatNumber(user.exp + totalExp)}*\n` +
      `├ ${EMOJI.coin} Monedas: *${formatNumber(user.money + totalMoney)}*\n` +
      `├ ${EMOJI.potion} Pociones: *${user.potion + potionReward}*\n` +
      `╰ 💎 Diamantes: *${formatNumber(user.limit + totalDiamonds)}*\n\n` +
      `${EMOJI.level} ¿Tienes suficiente XP? Usa *${usedPrefix}nivel* para subir.\n` +
      `💎 Usa */tienda diamantes* para gastar tus diamantes.`
    );
  }
};

export default dailyPlugin;
