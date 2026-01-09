/**
 * 📈 Plugin de Nivel - CYALTRONIC
 * Permite subir de nivel cuando hay suficiente XP
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, createProgressBar } from '../lib/utils.js';
import { canLevelUp, getLevelProgress, MULTIPLIER } from '../lib/levelling.js';
import { getRoleByLevel, getRankProgress, calculateTotalStats } from '../types/user.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { ITEMS, CLASSES } from '../types/rpg.js';

export const nivelPlugin: PluginHandler = {
  command: /^(nivel|lvl|levelup|level|subir)$/i,
  tags: ['rpg'],
  help: ['nivel - Subir de nivel si tienes suficiente XP'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar registro
    if (!user.registered) {
      return m.reply(CONFIG.messages.notRegistered);
    }

    // Verificar si puede subir de nivel
    if (!canLevelUp(user.level, user.exp, MULTIPLIER)) {
      const progress = getLevelProgress(user.level, user.exp, MULTIPLIER);
      const role = getRoleByLevel(user.level);
      const expBar = createProgressBar(progress.current, progress.needed, 10);

      return m.reply(
        `${EMOJI.info} *ESTADO DE NIVEL*\n\n` +
        `${EMOJI.level} Nivel actual: *${user.level}* ${role}\n` +
        `${EMOJI.exp} Experiencia: ${formatNumber(progress.current)}/${formatNumber(progress.needed)}\n` +
        `${expBar} ${progress.percent}%\n\n` +
        `${EMOJI.warning} Te faltan *${formatNumber(progress.remaining)}* XP para subir de nivel.\n\n` +
        `${EMOJI.info} *¿Cómo ganar XP?*\n` +
        `• *${usedPrefix}daily* - Recompensa diaria\n` +
        `• *${usedPrefix}work* - Trabajar por XP`
      );
    }

    // Guardar nivel anterior
    const previousLevel = user.level;
    const previousRole = getRoleByLevel(previousLevel);

    // Subir todos los niveles posibles
    while (canLevelUp(user.level, user.exp, MULTIPLIER)) {
      user.level++;
    }

    const newLevel = user.level;
    const newRole = getRoleByLevel(newLevel);
    const levelsGained = newLevel - previousLevel;

    // Calcular bonificaciones
    const bonus = CONFIG.rpg.levelUpBonus;
    const healthBonus = levelsGained * bonus.healthPerLevel;
    const staminaBonus = levelsGained * bonus.staminaPerLevel;
    const manaBonus = levelsGained * bonus.manaPerLevel;
    const moneyBonus = levelsGained * bonus.moneyPerLevel;

    // Actualizar maxHealth/maxStamina/maxMana base con los bonus de nivel
    user.maxHealth += healthBonus;
    user.maxStamina += staminaBonus;
    user.maxMana += manaBonus;

    // Calcular stats máximos reales (incluyendo clase y equipamiento)
    const realMaxStats = calculateTotalStats(user, ITEMS, CLASSES);

    // Aplicar bonificaciones - usar el máximo real para el límite
    user.health = Math.min(realMaxStats.maxHealth, user.health + healthBonus);
    user.stamina = Math.min(realMaxStats.maxStamina, user.stamina + staminaBonus);
    user.mana = Math.min(realMaxStats.maxMana, user.mana + manaBonus);
    user.money += moneyBonus;

    // Actualizar el rango en la base de datos
    user.role = newRole;

    // Guardar cambios
    db.updateUser(m.sender, user);

    // Verificar si cambió de rango
    const changedRole = previousRole !== newRole;

    // Construir mensaje de felicitación
    let message = `
${EMOJI.success}${EMOJI.fire}${EMOJI.success}${EMOJI.fire}${EMOJI.success}

  ${EMOJI.crown} *¡FELICIDADES, ${user.name}!* ${EMOJI.crown}

${levelsGained > 1
  ? `  ¡Has subido *${levelsGained} niveles*!`
  : `  ¡Has subido de nivel!`
}

╭═══════════════════════════╮
│  ${EMOJI.level} *NIVEL*
│  ${previousLevel} ➜ *${newLevel}*
├───────────────────────────
│  ${EMOJI.star} *RANGO*
│  ${previousRole}`;

    if (changedRole) {
      message += `
│        ⬇️
│  ${newRole} ${EMOJI.crown}`;
    }

    message += `
╰═══════════════════════════╯

${EMOJI.gift} *BONIFICACIONES OBTENIDAS*
├ +${healthBonus} ${EMOJI.health} Salud
├ +${staminaBonus} ${EMOJI.stamina} Energía
├ +${manaBonus} ${EMOJI.mana} Maná
├ +${formatNumber(moneyBonus)} ${EMOJI.coin} Monedas
╰───────────────────────────`;

    if (changedRole) {
      message += `

${EMOJI.trophy} *¡NUEVO RANGO DESBLOQUEADO!*
${EMOJI.sparkles} Ahora eres: *${newRole}*`;
    }

    // Mostrar progreso hacia el siguiente rango
    const rankProgress = getRankProgress(newLevel);
    if (!rankProgress.isMaxRank && rankProgress.nextRank) {
      message += `

📊 *Siguiente rango:* ${rankProgress.nextRank}
📈 Te faltan *${rankProgress.levelsToNext}* niveles`;
    } else if (rankProgress.isMaxRank) {
      message += `

🐉👑 *¡Has alcanzado el rango maximo!*`;
    }

    message += `

${EMOJI.sword} ¡Sigue jugando para ser más fuerte!`;

    await m.reply(message.trim());
  }
};

export default nivelPlugin;
