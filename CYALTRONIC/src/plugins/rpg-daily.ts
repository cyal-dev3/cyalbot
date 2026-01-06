/**
 * 🎁 Plugin Daily - CYALTRONIC
 * Recompensa diaria que se puede reclamar cada 2 horas
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, pickRandom } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';

export const dailyPlugin: PluginHandler = {
  command: /^(daily|claim|reclamar|regalo|diario)$/i,
  tags: ['rpg'],
  help: ['daily - Reclamar recompensa diaria (cada 2 horas)'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar registro
    if (!user.registered) {
      return m.reply(CONFIG.messages.notRegistered);
    }

    // Verificar cooldown
    const now = Date.now();
    const cooldown = CONFIG.cooldowns.daily;
    const timeSinceLastClaim = now - user.lastclaim;

    if (timeSinceLastClaim < cooldown) {
      const remaining = cooldown - timeSinceLastClaim;
      return m.reply(
        `${EMOJI.time} *¡Recompensa no disponible!*\n\n` +
        `${EMOJI.warning} Ya reclamaste tu regalo.\n` +
        `${EMOJI.info} Vuelve en: *${msToTime(remaining)}*\n\n` +
        `${EMOJI.star} Mientras tanto puedes usar:\n` +
        `• *${usedPrefix}work* - Trabajar por XP\n` +
        `• *${usedPrefix}perfil* - Ver tu progreso`
      );
    }

    // Generar recompensas aleatorias
    const rewards = CONFIG.rpg.dailyRewards;
    const expReward = pickRandom(rewards.exp);
    const moneyReward = pickRandom(rewards.money);
    const potionReward = pickRandom(rewards.potion);

    // Calcular streak (días consecutivos) - Feature bonus
    const lastClaimDate = new Date(user.lastclaim).toDateString();
    const todayDate = new Date().toDateString();
    const yesterdayDate = new Date(Date.now() - 86400000).toDateString();

    let streakBonus = 0;
    let streakMessage = '';

    // Si reclamó ayer, bonus de racha
    if (lastClaimDate === yesterdayDate) {
      streakBonus = Math.floor(expReward * 0.1); // 10% bonus
      streakMessage = `\n${EMOJI.fire} *Bonus de racha:* +${formatNumber(streakBonus)} ${EMOJI.exp}`;
    }

    // Aplicar recompensas
    const totalExp = expReward + streakBonus;

    db.updateUser(m.sender, {
      exp: user.exp + totalExp,
      money: user.money + moneyReward,
      potion: user.potion + potionReward,
      lastclaim: now
    });

    // Mensaje de recompensa
    await m.reply(
      `${EMOJI.gift}${EMOJI.sparkles} *¡RECOMPENSA DIARIA!* ${EMOJI.sparkles}${EMOJI.gift}\n\n` +
      `${EMOJI.success} *¡Has reclamado tu regalo, ${user.name}!*\n\n` +
      `╭═══════════════════════════╮\n` +
      `│  ${EMOJI.star} *RECOMPENSAS*\n` +
      `├───────────────────────────\n` +
      `│  +${formatNumber(expReward)} ${EMOJI.exp} Experiencia\n` +
      `│  +${formatNumber(moneyReward)} ${EMOJI.coin} Monedas\n` +
      `│  +${potionReward} ${EMOJI.potion} Pociones\n` +
      `╰═══════════════════════════╯${streakMessage}\n\n` +
      `${EMOJI.time} Próximo regalo en: *2 horas*\n\n` +
      `${EMOJI.info} *Tu nuevo balance:*\n` +
      `├ ${EMOJI.exp} EXP Total: *${formatNumber(user.exp + totalExp)}*\n` +
      `├ ${EMOJI.coin} Monedas: *${formatNumber(user.money + moneyReward)}*\n` +
      `╰ ${EMOJI.potion} Pociones: *${user.potion + potionReward}*\n\n` +
      `${EMOJI.level} ¿Tienes suficiente XP? Usa *${usedPrefix}nivel* para subir.`
    );
  }
};

export default dailyPlugin;
