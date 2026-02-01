/**
 * 🦹 Plugin de Robo - RPG
 * Comando: robar - Intenta robar recursos de otro jugador
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { updateQuestProgress } from './rpg-misiones.js';
import { getRankBenefits, getRoleByLevel } from '../types/user.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';
import { ROB, PVP } from '../constants/rpg.js';

/**
 * Tipos de recursos que se pueden robar
 */
type RobbableResource = 'money' | 'exp' | 'mana';

interface RobResult {
  success: boolean;
  resource: RobbableResource;
  amount: number;
  message: string;
}

/**
 * Mensajes de éxito al robar
 */
const SUCCESS_MESSAGES: Record<RobbableResource, string[]> = {
  money: [
    '💰 Te infiltraste sigilosamente y robaste {amount} monedas de {victim}!',
    '🦹 Como un verdadero ladrón, le quitaste {amount} monedas a {victim}!',
    '💸 Mientras {victim} dormía, le robaste {amount} monedas!',
    '🎭 Con tu disfraz perfecto, engañaste a {victim} y te llevaste {amount} monedas!',
    '🌙 Bajo la luz de la luna, robaste {amount} monedas de la bolsa de {victim}!'
  ],
  exp: [
    '✨ Absorbiste {amount} XP de la esencia vital de {victim}!',
    '🔮 Con magia oscura, drenaste {amount} XP de {victim}!',
    '⚡ Canalizaste la energía de {victim} y obtuviste {amount} XP!',
    '💫 El conocimiento de {victim} ahora es tuyo: +{amount} XP!',
    '🌟 Robaste {amount} puntos de experiencia del aura de {victim}!'
  ],
  mana: [
    '💠 Drenaste {amount} de maná de {victim}!',
    '🔵 Con un hechizo prohibido, robaste {amount} de maná a {victim}!',
    '💎 La energía mágica de {victim} fluye hacia ti: +{amount} maná!',
    '✨ Absorbiste {amount} puntos de maná de {victim}!',
    '🌀 El maná de {victim} ahora corre por tus venas: +{amount}!'
  ]
};

/**
 * Mensajes de fallo al robar
 */
const FAIL_MESSAGES = [
  '🚨 ¡{victim} te atrapó con las manos en la masa! Perdiste {penalty} monedas como multa.',
  '👮 ¡Los guardias te vieron! Pagaste {penalty} monedas de fianza.',
  '💥 ¡{victim} te noqueó mientras intentabas robarle! Perdiste {penalty} monedas.',
  '🐕 ¡El perro guardián de {victim} te mordió! Gastaste {penalty} monedas en curarte.',
  '⚔️ ¡{victim} estaba alerta y te venció! Dejaste caer {penalty} monedas.',
  '🪤 ¡Caíste en una trampa de {victim}! Perdiste {penalty} monedas.',
  '👁️ ¡Un testigo te delató! Pagaste {penalty} monedas para silenciarlo.',
  '🏃 ¡Huiste pero tropezaste! Se te cayeron {penalty} monedas.'
];

/**
 * Calcula el resultado del intento de robo
 */
function calculateRobAttempt(
  thiefLevel: number,
  victimLevel: number,
  victimMoney: number,
  victimExp: number,
  victimMana: number,
  robSuccessBonus: number = 0,
  robAmountBonus: number = 0
): RobResult {
  // Probabilidad base: 40%
  // +2% por cada nivel del ladrón
  // -3% por cada nivel de la víctima
  // +bonus por rango del ladrón
  const levelDiff = thiefLevel - victimLevel;
  const baseChance = 40;
  const thiefBonus = thiefLevel * 2;
  const victimDefense = victimLevel * 3;
  const rankBonus = robSuccessBonus; // Bonus de rango
  const successChance = Math.min(85, Math.max(15, baseChance + thiefBonus - victimDefense + (levelDiff * 2) + rankBonus));

  const roll = randomInt(1, 100);
  const success = roll <= successChance;

  if (!success) {
    // Falló - calcular penalización (aumentada)
    const penalty = randomInt(100, 500);
    return {
      success: false,
      resource: 'money',
      amount: penalty,
      message: pickRandom(FAIL_MESSAGES)
    };
  }

  // Éxito - determinar qué robar
  // Prioridad: dinero (70%), exp (20%), mana (10%)
  const resourceRoll = randomInt(1, 100);
  let resource: RobbableResource;
  let maxSteal: number;
  let minSteal: number;

  // Multiplicador por bonus de rango
  const amountMultiplier = 1 + (robAmountBonus / 100);

  if (resourceRoll <= 70 && victimMoney > 100) {
    resource = 'money';
    // Robar entre 15% y 35% del dinero de la víctima (AUMENTADO + bonus rango)
    minSteal = Math.floor(victimMoney * 0.15 * amountMultiplier);
    maxSteal = Math.floor(victimMoney * 0.35 * amountMultiplier);
  } else if (resourceRoll <= 90 && victimExp > 500) {
    resource = 'exp';
    // Robar entre 5% y 15% de la experiencia (AUMENTADO + bonus rango)
    minSteal = Math.floor(victimExp * 0.05 * amountMultiplier);
    maxSteal = Math.floor(victimExp * 0.15 * amountMultiplier);
  } else if (victimMana > 10) {
    resource = 'mana';
    // Robar entre 10 y 40 de maná (AUMENTADO + bonus rango)
    minSteal = Math.floor(10 * amountMultiplier);
    maxSteal = Math.min(Math.floor(40 * amountMultiplier), victimMana - 5);
  } else if (victimMoney > 0) {
    // Fallback a dinero solo si tiene algo
    resource = 'money';
    minSteal = Math.floor(victimMoney * 0.10 * amountMultiplier);
    maxSteal = Math.floor(victimMoney * 0.25 * amountMultiplier);
  } else {
    // Víctima no tiene nada que robar - retornar como fallo
    return {
      success: false,
      resource: 'money',
      amount: 0,
      message: '🫗 ¡La víctima no tiene nada que robar! Sus bolsillos están vacíos.'
    };
  }

  // Asegurar mínimos más altos
  minSteal = Math.max(minSteal, 50);
  maxSteal = Math.max(maxSteal, minSteal + 100);

  const amount = randomInt(minSteal, maxSteal);

  return {
    success: true,
    resource,
    amount: Math.max(amount, 50),
    message: pickRandom(SUCCESS_MESSAGES[resource])
  };
}

/**
 * Obtiene el JID del usuario objetivo
 */
function getTargetUser(ctx: MessageContext): string | null {
  // Primero menciones
  if (ctx.m.mentionedJid.length > 0) {
    return ctx.m.mentionedJid[0];
  }

  // Luego mensaje citado
  if (ctx.m.quoted?.sender) {
    return ctx.m.quoted.sender;
  }

  return null;
}

/**
 * Plugin: Robar - Intenta robar a otro jugador
 */
export const robarPlugin: PluginHandler = {
  command: ['robar', 'rob', 'steal', 'asaltar', 'hurtar'],
  tags: ['rpg'],
  help: [
    'robar @usuario - Intenta robar dinero, XP o maná',
    'El éxito depende de tu nivel vs el de la víctima',
    'Si fallas, pagarás una multa',
    'Cooldown: 1 hora'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const thief = db.getUser(m.sender);

    // Verificar nivel mínimo para PvP
    if (thief.level < PVP.MIN_LEVEL_PVP) {
      await m.reply(
        `${EMOJI.error} ¡Necesitas más experiencia para robar!\n\n` +
        `📊 Tu nivel: *${thief.level}*\n` +
        `🎯 Nivel requerido: *${PVP.MIN_LEVEL_PVP}*\n\n` +
        `💡 Sube de nivel atacando monstruos o trabajando.`
      );
      return;
    }

    // Verificar modos globales activos
    checkExpiredModes();
    const isFreeRobMode = globalModes.freeRobMode.active;
    const isChaosMode = globalModes.chaosMode.active;

    // Obtener beneficios de rango del ladrón
    const thiefRankBenefits = getRankBenefits(thief.level);
    const thiefRank = getRoleByLevel(thief.level);

    // Verificar cooldown (con reducción por rango) - SKIP si modo robo libre activo
    const now = Date.now();
    const baseCooldown = CONFIG.cooldowns.rob;
    const cooldownReduction = thiefRankBenefits.cooldownReduction / 100;
    const cooldown = Math.floor(baseCooldown * (1 - cooldownReduction));
    const lastRob = thief.lastRob || 0;

    if (!isFreeRobMode && now - lastRob < cooldown) {
      const remaining = cooldown - (now - lastRob);
      let cooldownMsg = `${EMOJI.time} ¡Los guardias te están buscando!\n\n` +
        `⏳ Espera *${msToTime(remaining)}* antes de volver a robar.`;

      if (thiefRankBenefits.cooldownReduction > 0) {
        cooldownMsg += `\n\n🎖️ _Tu rango reduce cooldowns -${thiefRankBenefits.cooldownReduction}%_`;
      }

      await m.reply(cooldownMsg);
      return;
    }

    // Obtener víctima
    const victimJid = getTargetUser(ctx);

    if (!victimJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres robar?\n\n` +
        `📝 *Uso:* ${usedPrefix}robar @usuario\n` +
        `💡 Menciona o responde al mensaje de tu víctima.`
      );
      return;
    }

    // No robarse a sí mismo
    if (victimJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes robarte a ti mismo... ¿o sí? 🤔`);
      return;
    }

    // Verificar que la víctima esté registrada
    const victim = db.getUser(victimJid);
    if (!victim.registered) {
      await m.reply(
        `${EMOJI.error} Esa persona no está registrada en el juego.\n` +
        `No hay nada que robarle... aún.`
      );
      return;
    }

    // Verificar que la víctima tenga recursos
    if (victim.money < 100 && victim.exp < 500 && victim.mana < 10) {
      await m.reply(
        `${EMOJI.warning} *${victim.name}* está en la pobreza total.\n` +
        `No vale la pena el riesgo... busca una víctima más jugosa. 💀`
      );
      return;
    }

    // Verificar si el ladrón está en modo pasivo
    if (thief.passiveMode && thief.passiveModeUntil > now) {
      await m.reply(
        `${EMOJI.error} Estás en *modo pasivo*.\n\n` +
        `🕊️ No puedes robar a nadie mientras estés protegido.\n` +
        `💡 Usa */pasivo* para desactivarlo (cooldown de 6h).`
      );
      return;
    }

    // Verificar si la víctima está en modo pasivo
    if (victim.passiveMode && victim.passiveModeUntil > now) {
      await m.reply(
        `🕊️ *${victim.name}* está en *modo pasivo*.\n\n` +
        `No puedes robar a jugadores protegidos.`
      );
      return;
    }

    // Verificar que el ladrón tenga dinero para la multa potencial
    if (thief.money < 50) {
      await m.reply(
        `${EMOJI.error} Necesitas al menos *50 monedas* para robar.\n` +
        `Si fallas, tendrás que pagar una multa.`
      );
      return;
    }

    // Realizar el intento de robo con bonus de rango
    await m.react('🦹');

    // Aplicar multiplicadores de modo caos si está activo
    let robSuccessBonus = thiefRankBenefits.robSuccessBonus;
    let robAmountBonus = thiefRankBenefits.robAmountBonus;

    if (isChaosMode) {
      robSuccessBonus += 20 * globalModes.chaosMode.multiplier; // Más éxito en caos
      robAmountBonus += 50 * globalModes.chaosMode.multiplier; // Más cantidad en caos
    }

    const result = calculateRobAttempt(
      thief.level,
      victim.level,
      victim.money,
      victim.exp,
      victim.mana,
      robSuccessBonus,
      robAmountBonus
    );

    // Aplicar el cooldown
    db.updateUser(m.sender, { lastRob: now });

    // Calcular tiempo del próximo robo
    const nextRobMinutes = isFreeRobMode ? 0 : Math.floor(cooldown / 60000);

    // Mensaje de modo especial activo
    let modeMsg = '';
    if (isFreeRobMode) {
      modeMsg = '\n🦹 *MODO ROBO LIBRE ACTIVO* - Sin cooldown!\n';
    }
    if (isChaosMode) {
      modeMsg += `\n🌀 *MODO CAOS x${globalModes.chaosMode.multiplier}* - Bonuses aumentados!\n`;
    }

    if (result.success) {
      // Éxito - transferir recursos
      const victimName = victim.name;

      switch (result.resource) {
        case 'money':
          db.updateUser(m.sender, { money: thief.money + result.amount });
          db.updateUser(victimJid, { money: Math.max(0, victim.money - result.amount) });
          break;
        case 'exp':
          db.updateUser(m.sender, { exp: thief.exp + result.amount });
          db.updateUser(victimJid, { exp: Math.max(0, victim.exp - result.amount) });
          break;
        case 'mana':
          db.updateUser(m.sender, { mana: Math.min(thief.maxMana, thief.mana + result.amount) });
          db.updateUser(victimJid, { mana: Math.max(0, victim.mana - result.amount) });
          break;
      }

      const message = result.message
        .replace('{amount}', formatNumber(result.amount))
        .replace('{victim}', victimName);

      const resourceEmoji = {
        money: EMOJI.coin,
        exp: EMOJI.exp,
        mana: EMOJI.mana
      };

      // Mensaje de bonus de rango
      let rankBonusMsg = '';
      if (thiefRankBenefits.robSuccessBonus > 0 || thiefRankBenefits.robAmountBonus > 0) {
        rankBonusMsg = `\n🎖️ *Rango:* ${thiefRank}\n` +
          `   +${thiefRankBenefits.robSuccessBonus}% éxito | +${thiefRankBenefits.robAmountBonus}% cantidad\n`;
      }

      await m.reply(
        `🦹 *¡ROBO EXITOSO!*\n\n` +
        `${message}\n\n` +
        `${resourceEmoji[result.resource]} *+${formatNumber(result.amount)}* ${result.resource === 'money' ? 'monedas' : result.resource === 'exp' ? 'XP' : 'maná'}` +
        `${rankBonusMsg}${modeMsg}\n` +
        `⏰ Próximo robo: *${isFreeRobMode ? '¡YA!' : nextRobMinutes + ' minutos'}*`
      );

      await m.react('💰');

    } else {
      // Falló - aplicar penalización
      const penalty = Math.min(result.amount, thief.money);
      db.updateUser(m.sender, { money: Math.max(0, thief.money - penalty) });

      const message = result.message
        .replace('{penalty}', formatNumber(penalty))
        .replace('{victim}', victim.name);

      await m.reply(
        `🚨 *¡ROBO FALLIDO!*\n\n` +
        `${message}\n\n` +
        `${EMOJI.coin} *-${formatNumber(penalty)}* monedas\n\n` +
        `🎖️ Tu rango: ${thiefRank}${modeMsg}\n` +
        `💡 _Tip: Tu éxito depende de la diferencia de niveles y tu rango._\n` +
        `⏰ Próximo intento: *${isFreeRobMode ? '¡YA!' : nextRobMinutes + ' minutos'}*`
      );

      await m.react('💀');
    }

    // Actualizar progreso de misiones de robo
    updateQuestProgress(db, m.sender, 'rob', 1);

    // Actualizar misión de ganar monedas si el robo fue exitoso y se robó dinero
    if (result.success && result.resource === 'money') {
      updateQuestProgress(db, m.sender, 'earn', result.amount);
    }
  }
};

export default robarPlugin;
