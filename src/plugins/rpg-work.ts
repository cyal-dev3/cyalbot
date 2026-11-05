import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, pickRandom, randomInt, checkCooldown } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits, getRoleByLevel } from '../types/user.js';
import { grantRewards, replyCooldown, formatReward } from '../lib/rpg-actions.js';

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
  usage: ['work'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();
    const benefits = getRankBenefits(user.level);

    const cd = checkCooldown(user.lastWork, CONFIG.cooldowns.work, benefits.cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [
        { cmd: 'minar', desc: 'Minar minerales' },
        { cmd: 'perfil', desc: 'Ver tu progreso' }
      ]);
    }

    const workConfig = CONFIG.rpg.workRewards;
    const baseExp = Math.floor((workConfig.baseExp + user.level * workConfig.levelMultiplier) * (0.5 + Math.random()));

    // La probabilidad de bonus sube un poco con el multiplicador de dinero del rango
    const bonusChance = workConfig.bonusChance + (benefits.moneyMultiplier - 1) * 0.1;
    const bonusMoney = Math.random() < bonusChance ? randomInt(workConfig.bonusMoney.min, workConfig.bonusMoney.max) : 0;

    db.updateUser(m.sender, { lastWork: now });

    const result = grantRewards(
      db,
      m.sender,
      { exp: baseExp, money: bonusMoney, questObjectives: [{ objective: 'work', amount: 1 }] },
      { source: 'work', now }
    );

    const activity = pickRandom(WORK_ACTIVITIES);
    const lines = [`+${formatNumber(result.exp)} ${EMOJI.exp} XP`];
    if (result.money > 0) lines.push(`+${formatNumber(result.money)} ${EMOJI.coin} monedas (bonus)`);
    if (benefits.expMultiplier > 1) lines.push(`🎖️ Rango ${getRoleByLevel(user.level)}: x${benefits.expMultiplier} XP`);
    lines.push(...result.lines);

    const fresh = db.getUser(m.sender);
    await m.reply(formatReward(ctx, `${EMOJI.work} Trabajo completado`, lines, {
      intro: `${activity.emoji} *${activity.text}*`,
      footer: `${EMOJI.level} Nivel *${fresh.level}* · ${EMOJI.exp} ${formatNumber(fresh.exp)} XP · ${EMOJI.coin} ${formatNumber(fresh.money)}\n` +
        `${EMOJI.time} Próximo trabajo en *${Math.floor(cd.effectiveCooldown / 60000)} minutos*. Prueba *${usedPrefix}minar* mientras tanto.`
    }));
  }
};

export default workPlugin;
