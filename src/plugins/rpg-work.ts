/**
 * Plugin Work
 * Trabajar para ganar experiencia cada 10 minutos
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, pickRandom, randomInt } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { canLevelUp, MULTIPLIER } from '../lib/levelling.js';
import { updateQuestProgress } from './rpg-misiones.js';
import { getRankBenefits, getRoleByLevel } from '../types/user.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';

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

    // Verificar modos globales expirados
    checkExpiredModes();

    // Obtener beneficios de rango
    const rankBenefits = getRankBenefits(user.level);
    const userRank = getRoleByLevel(user.level);

    // Verificar cooldown (con reducción por rango)
    const now = Date.now();
    const baseCooldown = CONFIG.cooldowns.work;
    const cooldownReduction = rankBenefits.cooldownReduction / 100;
    const cooldown = Math.floor(baseCooldown * (1 - cooldownReduction));
    const timeSinceLastWork = now - user.lastWork;

    if (timeSinceLastWork < cooldown) {
      const remaining = cooldown - timeSinceLastWork;
      let cooldownMsg = `${EMOJI.time} *¡Estás descansando!*\n\n` +
        `${EMOJI.warning} Necesitas recuperar energía.\n` +
        `${EMOJI.info} Podrás trabajar en: *${msToTime(remaining)}*\n\n` +
        `${EMOJI.star} Mientras tanto:\n` +
        `• *${usedPrefix}perfil* - Ver tu progreso\n` +
        `• *${usedPrefix}nivel* - Subir de nivel`;

      if (rankBenefits.cooldownReduction > 0) {
        cooldownMsg += `\n\n🎖️ _Tu rango reduce cooldowns -${rankBenefits.cooldownReduction}%_`;
      }

      return m.reply(cooldownMsg);
    }

    // Calcular recompensa basada en nivel
    const workConfig = CONFIG.rpg.workRewards;
    const baseExp = workConfig.baseExp + (user.level * workConfig.levelMultiplier);
    const randomMultiplier = 0.5 + Math.random(); // 0.5x a 1.5x

    // Aplicar multiplicador de rango a XP
    const expBeforeBonus = Math.floor(baseExp * randomMultiplier);
    let expReward = Math.floor(expBeforeBonus * rankBenefits.expMultiplier);
    const rankExpBonus = expReward - expBeforeBonus;

    // Aplicar multiplicadores de modos globales
    let globalExpBonus = 0;
    let globalMoneyBonus = 0;
    let modeMessages: string[] = [];

    // Bonus Mode - Multiplicador de XP y dinero
    if (globalModes.bonusMode.active) {
      const bonusExp = Math.floor(expReward * (globalModes.bonusMode.expMultiplier - 1));
      globalExpBonus += bonusExp;
      modeMessages.push(`🎁 Modo Bonus: +${bonusExp} XP (x${globalModes.bonusMode.expMultiplier})`);
    }

    // Chaos Mode - Multiplicador general
    if (globalModes.chaosMode.active) {
      const chaosExp = Math.floor(expReward * (globalModes.chaosMode.multiplier - 1));
      globalExpBonus += chaosExp;
      modeMessages.push(`🌀 Modo Caos: +${chaosExp} XP (x${globalModes.chaosMode.multiplier})`);
    }

    // Event Mode - Multiplicador de drops/recompensas
    if (globalModes.eventMode.active) {
      const eventExp = Math.floor(expReward * (globalModes.eventMode.dropMultiplier - 1));
      globalExpBonus += eventExp;
      modeMessages.push(`🎉 ${globalModes.eventMode.eventName}: +${eventExp} XP (x${globalModes.eventMode.dropMultiplier})`);
    }

    // Aplicar bonos globales
    expReward += globalExpBonus;

    // Probabilidad de bonus (aumentada por rango)
    let bonusMoney = 0;
    let bonusMessage = '';
    const bonusChance = workConfig.bonusChance + (rankBenefits.moneyMultiplier - 1) * 0.1;
    const hasBonus = Math.random() < bonusChance;

    if (hasBonus) {
      const baseMoney = randomInt(workConfig.bonusMoney.min, workConfig.bonusMoney.max);
      bonusMoney = Math.floor(baseMoney * rankBenefits.moneyMultiplier);

      // Aplicar multiplicadores de modos globales al dinero
      if (globalModes.bonusMode.active) {
        const bonusMoneyFromMode = Math.floor(bonusMoney * (globalModes.bonusMode.moneyMultiplier - 1));
        globalMoneyBonus += bonusMoneyFromMode;
      }
      if (globalModes.chaosMode.active) {
        const chaosMoneyBonus = Math.floor(bonusMoney * (globalModes.chaosMode.multiplier - 1));
        globalMoneyBonus += chaosMoneyBonus;
      }
      if (globalModes.eventMode.active) {
        const eventMoneyBonus = Math.floor(bonusMoney * (globalModes.eventMode.dropMultiplier - 1));
        globalMoneyBonus += eventMoneyBonus;
      }

      bonusMoney += globalMoneyBonus;
      bonusMessage = `\n│  +${formatNumber(bonusMoney)} ${EMOJI.coin} Monedas`;
    }

    // Seleccionar actividad aleatoria
    const activity = pickRandom(WORK_ACTIVITIES);

    // Verificar si el usuario es esclavo y transferir parte al amo
    let slaveryMessage = '';
    let masterExpCut = 0;
    let masterMoneyCut = 0;
    const SLAVERY_CUT_PERCENT = 50; // 50% va al amo

    if (user.slaveMaster && user.slaveUntil > now) {
      const master = db.getUser(user.slaveMaster);

      // Calcular el corte del amo (50%)
      masterExpCut = Math.floor(expReward * (SLAVERY_CUT_PERCENT / 100));
      masterMoneyCut = Math.floor(bonusMoney * (SLAVERY_CUT_PERCENT / 100));

      // Reducir las ganancias del esclavo
      expReward -= masterExpCut;
      bonusMoney -= masterMoneyCut;

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

    // Aplicar recompensas
    db.updateUser(m.sender, {
      exp: user.exp + expReward,
      money: user.money + bonusMoney,
      lastWork: now
    });

    // Verificar si puede subir de nivel
    const canLevel = canLevelUp(user.level, user.exp + expReward, MULTIPLIER);
    const levelMessage = canLevel
      ? `\n\n${EMOJI.level} *¡Puedes subir de nivel!* Usa *${usedPrefix}nivel*`
      : '';

    // Actualizar progreso de misiones de trabajo
    updateQuestProgress(db, m.sender, 'work', 1);

    // Actualizar misión de ganar monedas si hubo bonus
    if (bonusMoney > 0) {
      updateQuestProgress(db, m.sender, 'earn', bonusMoney);
    }

    // Mensaje de bonus de rango
    let rankBonusMsg = '';
    if (rankExpBonus > 0) {
      rankBonusMsg = `\n│  🎖️ +${formatNumber(rankExpBonus)} XP (Bonus rango)`;
    }

    // Mensaje de modos activos
    let modesMsg = '';
    if (modeMessages.length > 0) {
      modesMsg = '\n│  ' + modeMessages.join('\n│  ');
    }

    // Calcular tiempo del próximo trabajo
    const nextWorkMinutes = Math.floor(cooldown / 60000);

    // Mensaje de trabajo completado
    await m.reply(
      `${EMOJI.work}${EMOJI.sparkles} *¡TRABAJO COMPLETADO!* ${EMOJI.sparkles}${EMOJI.work}\n\n` +
      `${activity.emoji} *${activity.text}*\n\n` +
      `╭═══════════════════════════╮\n` +
      `│  ${EMOJI.success} *RECOMPENSA*\n` +
      `├───────────────────────────\n` +
      `│  +${formatNumber(expReward)} ${EMOJI.exp} Experiencia${rankBonusMsg}${modesMsg}${bonusMessage}\n` +
      `╰═══════════════════════════╯\n\n` +
      `🎖️ *Rango:* ${userRank}\n\n` +
      `${EMOJI.info} *Tu progreso:*\n` +
      `├ ${EMOJI.exp} EXP Total: *${formatNumber(user.exp + expReward)}*\n` +
      `├ ${EMOJI.level} Nivel: *${user.level}*\n` +
      `╰ ${EMOJI.coin} Monedas: *${formatNumber(user.money + bonusMoney)}*\n\n` +
      `${EMOJI.time} Próximo trabajo en: *${nextWorkMinutes} minutos*${slaveryMessage}${levelMessage}`
    );
  }
};

export default workPlugin;
