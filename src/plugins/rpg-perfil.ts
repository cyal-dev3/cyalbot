/**
 * Plugin de Perfil
 * Muestra el perfil y estadísticas del jugador
 */

import { createHash } from 'crypto';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, createProgressBar, msToTime } from '../lib/utils.js';
import { getLevelProgress, MULTIPLIER } from '../lib/levelling.js';
import { getRoleByLevel, type UserRPG } from '../types/user.js';
import { getDatabase } from '../lib/database.js';
import { ITEMS, CLASSES } from '../types/rpg.js';
import { applyRegenToUser, getRegenInfo } from '../lib/auto-regen.js';

/**
 * Calcula los stats máximos reales del jugador (incluyendo clase y equipamiento)
 */
function getRealMaxStats(user: UserRPG): { maxHealth: number; maxMana: number; maxStamina: number } {
  // Stats base
  let maxHealth = user.maxHealth;
  let maxMana = user.maxMana;
  let maxStamina = user.maxStamina;

  // Bonus de clase
  if (user.playerClass && CLASSES[user.playerClass]) {
    const classInfo = CLASSES[user.playerClass];
    maxHealth += classInfo.baseStats.healthBonus;
    maxMana += classInfo.baseStats.manaBonus;
    maxStamina += classInfo.baseStats.staminaBonus;
  }

  // Bonus de equipamiento
  const equipmentSlots = [user.equipment.weapon, user.equipment.armor, user.equipment.accessory];
  for (const itemId of equipmentSlots) {
    if (itemId && ITEMS[itemId]?.stats) {
      const stats = ITEMS[itemId].stats;
      if (stats.health) maxHealth += stats.health;
      if (stats.mana) maxMana += stats.mana;
      if (stats.stamina) maxStamina += stats.stamina;
    }
  }

  return { maxHealth, maxMana, maxStamina };
}

export const perfilPlugin: PluginHandler = {
  command: /^(perfil|profile|me|yo)$/i,
  tags: ['rpg'],
  help: [
    'perfil - Ver tu perfil',
    'perfil @usuario - Ver perfil de otro jugador'
  ],

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();

    // Determinar a quién ver el perfil
    const targetJid = m.mentionedJid[0] || m.quoted?.sender || m.sender;
    const isSelf = targetJid === m.sender;
    const user = db.getUser(targetJid);

    // Verificar si está registrado
    if (!user.registered) {
      if (isSelf) {
        return m.reply(
          `${EMOJI.error} *¡No estás registrado!*\n\n` +
          `${EMOJI.info} Usa *${usedPrefix}verificar nombre.edad* para comenzar tu aventura.`
        );
      } else {
        return m.reply(
          `${EMOJI.error} *Este usuario no está registrado.*`
        );
      }
    }

    // Aplicar regeneración pasiva antes de mostrar el perfil
    const regen = applyRegenToUser(targetJid);
    const regenInfo = getRegenInfo(targetJid);

    // Recargar usuario después de la regeneración
    const updatedUser = db.getUser(targetJid);

    // Calcular información de nivel
    const progress = getLevelProgress(updatedUser.level, updatedUser.exp, MULTIPLIER);
    const role = getRoleByLevel(updatedUser.level);

    // Calcular stats máximos reales (incluyendo clase y equipamiento)
    const realMax = getRealMaxStats(updatedUser);

    // Generar ID único
    const serialNumber = createHash('md5')
      .update(targetJid)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();

    // Calcular tiempo jugando
    const registeredDays = Math.floor((Date.now() - updatedUser.regTime) / (1000 * 60 * 60 * 24));

    // Mensaje de regeneración si hubo
    let regenMessage = '';
    if (regen.healthRegen > 0 || regen.staminaRegen > 0) {
      regenMessage = `\n🔄 *Regeneración aplicada:*`;
      if (regen.healthRegen > 0) regenMessage += ` ❤️+${regen.healthRegen}`;
      if (regen.staminaRegen > 0) regenMessage += ` ⚡+${regen.staminaRegen}`;
      regenMessage += '\n';
    }

    // Barra de progreso visual
    const expBar = createProgressBar(progress.current, progress.needed, 10);

    // Construir perfil
    const profile = `
${EMOJI.crown}═══════════════════════════${EMOJI.crown}
      *PERFIL DE JUGADOR*
${EMOJI.crown}═══════════════════════════${EMOJI.crown}
${regenMessage}
${EMOJI.star} *${updatedUser.name}*
${EMOJI.info} ID: #${serialNumber}
${EMOJI.time} Jugando hace: ${registeredDays} días

╭─────────────────────────╮
│  ${EMOJI.level} *PROGRESIÓN*
├─────────────────────────
│  Nivel: *${updatedUser.level}* ${role}
│  EXP: ${formatNumber(progress.current)}/${formatNumber(progress.needed)}
│  ${expBar} ${progress.percent}%
│  Para subir: *${formatNumber(progress.remaining)}* XP
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.sword} *ESTADÍSTICAS*
├─────────────────────────
│  ${EMOJI.health} Salud: ${updatedUser.health}/${realMax.maxHealth}
│  ${createProgressBar(updatedUser.health, realMax.maxHealth, 8)}
│
│  ${EMOJI.stamina} Energía: ${updatedUser.stamina}/${realMax.maxStamina}
│  ${createProgressBar(updatedUser.stamina, realMax.maxStamina, 8)}
│
│  ${EMOJI.mana} Maná: ${updatedUser.mana}/${realMax.maxMana}
│  ${createProgressBar(updatedUser.mana, realMax.maxMana, 8)}
│
│  🔄 Regen: +${regenInfo.healthPerHour}❤️/h +${regenInfo.staminaPerHour}⚡/h
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.coin} *ECONOMÍA*
├─────────────────────────
│  ${EMOJI.coin} Monedas: *${formatNumber(updatedUser.money)}*
│  ${EMOJI.diamond} Diamantes: *${formatNumber(updatedUser.limit)}*
│  ${EMOJI.potion} Pociones: *${updatedUser.potion}*
╰─────────────────────────╯

${EMOJI.sparkles} *EXP Total: ${formatNumber(updatedUser.exp)}*
`.trim();

    await m.reply(profile);
  }
};

export default perfilPlugin;
