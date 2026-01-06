/**
 * 🔨 Plugin Work - CYALTRONIC
 * Trabajar para ganar experiencia cada 10 minutos
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, pickRandom, randomInt } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { canLevelUp, MULTIPLIER } from '../lib/levelling.js';

// Lista de trabajos/aventuras
const WORK_ACTIVITIES = [
  // Combate
  { text: 'Derrotaste a un grupo de bandidos en el camino', emoji: '⚔️' },
  { text: 'Eliminaste a un lobo salvaje que aterrorizaba la aldea', emoji: '🐺' },
  { text: 'Venciste a un troll bajo el puente', emoji: '👹' },
  { text: 'Acabaste con una plaga de slimes en la cueva', emoji: '🟢' },
  { text: 'Defendiste el pueblo de una horda de goblins', emoji: '👺' },

  // Exploración
  { text: 'Exploraste una cueva antigua y encontraste tesoros', emoji: '🗺️' },
  { text: 'Descubriste un santuario oculto en las montañas', emoji: '⛰️' },
  { text: 'Navegaste por aguas peligrosas y sobreviviste', emoji: '⛵' },
  { text: 'Atravesaste el bosque encantado sin perderte', emoji: '🌲' },

  // Misiones
  { text: 'Completaste una misión de escolta para un mercader', emoji: '📦' },
  { text: 'Ayudaste a un aldeano a encontrar su ganado perdido', emoji: '🐄' },
  { text: 'Entregaste un mensaje urgente al reino vecino', emoji: '📜' },
  { text: 'Rescataste a un viajero de una emboscada', emoji: '🦸' },

  // Recolección
  { text: 'Recolectaste hierbas medicinales para el curandero', emoji: '🌿' },
  { text: 'Minaste minerales valiosos en las profundidades', emoji: '⛏️' },
  { text: 'Pescaste criaturas raras en el lago místico', emoji: '🎣' },
  { text: 'Cazaste presas en el bosque oscuro', emoji: '🏹' },

  // Entrenamiento
  { text: 'Entrenaste con el maestro de armas del castillo', emoji: '🗡️' },
  { text: 'Practicaste magia con el hechicero del pueblo', emoji: '🔮' },
  { text: 'Fortaleciste tu cuerpo en el gimnasio de guerreros', emoji: '💪' },

  // Trabajo
  { text: 'Forjaste armas con el herrero del pueblo', emoji: '🔨' },
  { text: 'Cultivaste el jardín de hierbas mágicas', emoji: '🌱' },
  { text: 'Construiste defensas para la muralla del pueblo', emoji: '🧱' },
  { text: 'Vendiste pociones en el mercado', emoji: '🧪' }
];

export const workPlugin: PluginHandler = {
  command: /^(work|trabajar|chambear|aventura|trabajito)$/i,
  tags: ['rpg'],
  help: ['work - Trabajar para ganar XP (cada 10 minutos)'],
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
    const cooldown = CONFIG.cooldowns.work;
    const timeSinceLastWork = now - user.lastwork;

    if (timeSinceLastWork < cooldown) {
      const remaining = cooldown - timeSinceLastWork;
      return m.reply(
        `${EMOJI.time} *¡Estás descansando!*\n\n` +
        `${EMOJI.warning} Necesitas recuperar energía.\n` +
        `${EMOJI.info} Podrás trabajar en: *${msToTime(remaining)}*\n\n` +
        `${EMOJI.star} Mientras tanto:\n` +
        `• *${usedPrefix}perfil* - Ver tu progreso\n` +
        `• *${usedPrefix}nivel* - Subir de nivel`
      );
    }

    // Calcular recompensa basada en nivel
    const workConfig = CONFIG.rpg.workRewards;
    const baseExp = workConfig.baseExp + (user.level * workConfig.levelMultiplier);
    const randomMultiplier = 0.5 + Math.random(); // 0.5x a 1.5x
    const expReward = Math.floor(baseExp * randomMultiplier);

    // Probabilidad de bonus
    let bonusMoney = 0;
    let bonusMessage = '';
    const hasBonus = Math.random() < workConfig.bonusChance;

    if (hasBonus) {
      bonusMoney = randomInt(workConfig.bonusMoney.min, workConfig.bonusMoney.max);
      bonusMessage = `\n${EMOJI.gift} *¡BONUS!* +${formatNumber(bonusMoney)} ${EMOJI.coin}`;
    }

    // Seleccionar actividad aleatoria
    const activity = pickRandom(WORK_ACTIVITIES);

    // Aplicar recompensas
    db.updateUser(m.sender, {
      exp: user.exp + expReward,
      money: user.money + bonusMoney,
      lastwork: now
    });

    // Verificar si puede subir de nivel
    const canLevel = canLevelUp(user.level, user.exp + expReward, MULTIPLIER);
    const levelMessage = canLevel
      ? `\n\n${EMOJI.level} *¡Puedes subir de nivel!* Usa *${usedPrefix}nivel*`
      : '';

    // Mensaje de trabajo completado
    await m.reply(
      `${EMOJI.work}${EMOJI.sparkles} *¡TRABAJO COMPLETADO!* ${EMOJI.sparkles}${EMOJI.work}\n\n` +
      `${activity.emoji} *${activity.text}*\n\n` +
      `╭═══════════════════════════╮\n` +
      `│  ${EMOJI.success} *RECOMPENSA*\n` +
      `├───────────────────────────\n` +
      `│  +${formatNumber(expReward)} ${EMOJI.exp} Experiencia${bonusMessage}\n` +
      `╰═══════════════════════════╯\n\n` +
      `${EMOJI.info} *Tu progreso:*\n` +
      `├ ${EMOJI.exp} EXP Total: *${formatNumber(user.exp + expReward)}*\n` +
      `├ ${EMOJI.level} Nivel: *${user.level}*\n` +
      `╰ ${EMOJI.coin} Monedas: *${formatNumber(user.money + bonusMoney)}*\n\n` +
      `${EMOJI.time} Próximo trabajo en: *10 minutos*${levelMessage}`
    );
  }
};

export default workPlugin;
