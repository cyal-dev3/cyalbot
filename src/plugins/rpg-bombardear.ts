/**
 * Plugin de Bombardeo - RPG
 * Comando: bombardear - Lanza una bomba a otro jugador
 * Sistema de probabilidades con cuotas del IMSS
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { calculateTotalStats, type UserRPG } from '../types/user.js';
import { ITEMS, CLASSES } from '../types/rpg.js';
import { PVP } from '../constants/rpg.js';

// Usar constantes centralizadas
const BOMB_COOLDOWN = PVP.BOMB_COOLDOWN;
const SHIELD_DURATION = PVP.SHIELD_DURATION;
const BACKFIRE_CHANCE = PVP.BACKFIRE_CHANCE;
const BOMB_DAMAGE_MIN = PVP.BOMB_DAMAGE.MIN;
const BOMB_DAMAGE_MAX = PVP.BOMB_DAMAGE.MAX;

/**
 * Mensajes de bombardeo exitoso
 */
const SUCCESS_MESSAGES = [
  '💣💥 *{attacker}* lanzó una bomba a *{victim}* y le voló en pedazos!',
  '🧨💥 *{attacker}* bombardeó a *{victim}*! ¡BOOM!',
  '💣🔥 La bomba de *{attacker}* alcanzó a *{victim}*! ¡Explosión masiva!',
  '🎇💥 *{attacker}* le aventó una granada a *{victim}*! ¡Directo al blanco!',
  '💣☠️ *{victim}* no vio venir la bomba de *{attacker}*! ¡RIP!'
];

/**
 * Mensajes de backfire
 */
const BACKFIRE_MESSAGES = [
  '💣💥 ¡OOPS! La bomba de *{attacker}* le explotó en la cara!',
  '🧨🤡 *{attacker}* tiró mal la bomba y se voló a sí mismo!',
  '💣😵 La mecha estaba muy corta... *{attacker}* se hizo pedazos!',
  '🎇💀 *{attacker}* olvidó soltar la bomba... ¡BOOM en sus manos!',
  '💣🤦 *{attacker}* se tropezó y la bomba le cayó encima!'
];

/**
 * Calcula la cuota del IMSS basada en probabilidades
 * - 70% probabilidad: 500-2000 pesos (cuota baja)
 * - 25% probabilidad: 2001-5000 pesos (cuota media)
 * - 5% probabilidad: 5001-10000 pesos (cuota alta)
 */
export function calculateIMSSFee(): { amount: number; tier: 'low' | 'medium' | 'high' } {
  const roll = randomInt(1, 100);

  if (roll <= 70) {
    // Cuota baja (70%)
    return { amount: randomInt(500, 2000), tier: 'low' };
  } else if (roll <= 95) {
    // Cuota media (25%)
    return { amount: randomInt(2001, 5000), tier: 'medium' };
  } else {
    // Cuota alta (5%)
    return { amount: randomInt(5001, 10000), tier: 'high' };
  }
}

/**
 * Aplica la penalización de muerte (cuota IMSS)
 * @param db - Instancia de la base de datos
 * @param userJid - JID del usuario que murió
 * @param user - Datos del usuario
 * @returns Información sobre la cuota aplicada
 */
export function applyDeathPenalty(
  db: ReturnType<typeof getDatabase>,
  userJid: string,
  user: UserRPG
): { fee: number; tier: string; paid: boolean; newDebt: number; insured: boolean } {
  // Verificar si tiene seguro de vida activo
  const now = Date.now();
  if (user.seguroVida && user.seguroVida > now) {
    return {
      fee: 0,
      tier: '📜 Seguro Premium',
      paid: true,
      newDebt: user.debt,
      insured: true
    };
  }

  const { amount: fee, tier } = calculateIMSSFee();

  let tierEmoji = '🏥';
  let tierName = 'baja';

  if (tier === 'medium') {
    tierEmoji = '🏨';
    tierName = 'media';
  } else if (tier === 'high') {
    tierEmoji = '🏩';
    tierName = 'ALTA';
  }

  // Verificar si puede pagar
  if (user.money >= fee) {
    // Puede pagar - se descuenta del dinero
    db.updateUser(userJid, {
      money: user.money - fee
    });
    return {
      fee,
      tier: `${tierEmoji} ${tierName}`,
      paid: true,
      newDebt: user.debt,
      insured: false
    };
  } else {
    // No puede pagar - se agrega a la deuda
    const partialPayment = user.money;
    const remainingDebt = fee - partialPayment;
    const newTotalDebt = user.debt + remainingDebt;

    db.updateUser(userJid, {
      money: 0,
      debt: newTotalDebt
    });

    return {
      fee,
      tier: `${tierEmoji} ${tierName}`,
      paid: false,
      newDebt: newTotalDebt,
      insured: false
    };
  }
}

/**
 * Genera el mensaje de cuota IMSS
 */
export function generateIMSSMessage(result: ReturnType<typeof applyDeathPenalty>, userName: string): string {
  let msg = `\n🏥 *CUOTA DEL IMSS*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 Paciente: *${userName}*\n`;

  // Si tiene seguro de vida
  if (result.insured) {
    msg += `📜 *SEGURO DE VIDA PREMIUM ACTIVO*\n\n`;
    msg += `✅ *Cuota cubierta por tu seguro*\n`;
    msg += `💵 Costo: *$0* (seguro activo)\n`;
    msg += `_Tu seguro de vida te ha salvado de la deuda_`;
    return msg;
  }

  msg += `💊 Urgencia: ${result.tier}\n`;
  msg += `💵 Cuota médica: *$${formatNumber(result.fee)}*\n\n`;

  if (result.paid) {
    msg += `✅ *Cuota pagada exitosamente*\n`;
    msg += `_Gracias por confiar en el IMSS_`;
  } else {
    msg += `❌ *No tienes suficiente dinero*\n`;
    msg += `📋 Deuda total con IMSS: *$${formatNumber(result.newDebt)}*\n`;
    msg += `⚠️ _Paga tu deuda con /pagardeuda_`;
  }

  return msg;
}

/**
 * Obtiene el JID del usuario objetivo
 */
function getTargetUser(ctx: MessageContext): string | null {
  if (ctx.m.mentionedJid.length > 0) {
    return ctx.m.mentionedJid[0];
  }
  if (ctx.m.quoted?.sender) {
    return ctx.m.quoted.sender;
  }
  return null;
}

/**
 * Plugin: Bombardear - Lanza una bomba a otro jugador
 */
export const bombardearPlugin: PluginHandler = {
  command: ['bombardear', 'bomba', 'bomb', 'granada'],
  tags: ['rpg'],
  help: [
    'bombardear @usuario - Lanza una bomba a otro jugador',
    'Cuidado! Puede explotarte en la cara (35% probabilidad)',
    'Si mueres, pagarás cuota del IMSS ($500-$10,000)',
    'Cooldown: 5 minutos'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const attacker = db.getUser(m.sender);

    // Verificar cooldown de bombardeo
    const now = Date.now();
    const lastBomb = attacker.lastBomb || 0;

    if (now - lastBomb < BOMB_COOLDOWN) {
      const remaining = BOMB_COOLDOWN - (now - lastBomb);
      const minutes = Math.ceil(remaining / 60000);
      await m.reply(
        `${EMOJI.time} ¡Necesitas preparar más bombas!\n\n` +
        `⏳ Espera *${minutes} minuto${minutes > 1 ? 's' : ''}* para bombardear de nuevo.`
      );
      return;
    }

    // Calcular stats reales del atacante (incluyendo clase y equipamiento)
    const attackerStats = calculateTotalStats(attacker, ITEMS, CLASSES);

    // Verificar salud del atacante
    if (attacker.health < PVP.MIN_HEALTH_COMBAT) {
      await m.reply(
        `${EMOJI.error} ¡Estás muy débil para manejar explosivos!\n\n` +
        `❤️ Salud actual: *${attacker.health}/${attackerStats.maxHealth}*\n` +
        `💡 Usa una poción para curarte.`
      );
      return;
    }

    // Obtener objetivo
    const targetJid = getTargetUser(ctx);

    if (!targetJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres bombardear?\n\n` +
        `📝 *Uso:* /bombardear @usuario\n` +
        `⚠️ ¡Cuidado! 35% de probabilidad de explotarte a ti mismo`
      );
      return;
    }

    if (targetJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes bombardearte a ti mismo... ¿o sí? 🤔`);
      return;
    }

    const target = db.getUser(targetJid);

    if (!target.registered) {
      await m.reply(`${EMOJI.error} Ese jugador no está registrado en el RPG.`);
      return;
    }

    // Verificar si el objetivo tiene escudo antibombas activo
    if (target.shieldBombas && target.shieldBombas > now) {
      const remainingTime = target.shieldBombas - now;
      const hoursLeft = Math.ceil(remainingTime / (60 * 60 * 1000));
      await m.reply(
        `🧱 *¡${target.name} tiene un Escudo Antibombas activo!*\n\n` +
        `La bomba rebotó en el escudo y se desactivó.\n` +
        `⏳ Protección restante: *${hoursLeft}h*\n\n` +
        `💡 Intenta con otra víctima o espera a que expire.`
      );
      await m.react('🧱');
      return;
    }

    await m.react('💣');

    // Aplicar cooldown
    db.updateUser(m.sender, { lastBomb: now });

    // Calcular daño de la bomba
    const bombDamage = randomInt(BOMB_DAMAGE_MIN, BOMB_DAMAGE_MAX);

    // Determinar si hay backfire
    const backfireRoll = randomInt(1, 100);
    const isBackfire = backfireRoll <= BACKFIRE_CHANCE;

    if (isBackfire) {
      // ¡La bomba explota al atacante!
      const newHealth = Math.max(0, attacker.health - bombDamage);
      const isDead = newHealth <= 0;

      let response = pickRandom(BACKFIRE_MESSAGES)
        .replace(/{attacker}/g, attacker.name);

      response += `\n\n💥 *Daño recibido:* ${bombDamage}\n`;
      response += `❤️ *Salud:* ${newHealth}/${attackerStats.maxHealth}\n`;

      if (isDead) {
        // El atacante murió - aplicar cuota IMSS
        const freshAttacker = db.getUser(m.sender);
        const imssResult = applyDeathPenalty(db, m.sender, freshAttacker);

        db.updateUser(m.sender, { health: 1 }); // Revivir con 1 HP

        response += `\n💀 *¡HAS MUERTO!*\n`;
        response += generateIMSSMessage(imssResult, attacker.name);
      } else {
        db.updateUser(m.sender, { health: newHealth });
      }

      await m.reply(response);
      await m.react('🤡');

    } else {
      // ¡Bombardeo exitoso!
      const newTargetHealth = Math.max(0, target.health - bombDamage);
      const targetDied = newTargetHealth <= 0;

      // Calcular stats reales del objetivo
      const targetStats = calculateTotalStats(target, ITEMS, CLASSES);

      let response = pickRandom(SUCCESS_MESSAGES)
        .replace(/{attacker}/g, attacker.name)
        .replace(/{victim}/g, target.name);

      response += `\n\n💥 *Daño causado:* ${bombDamage}\n`;
      response += `❤️ *Salud de ${target.name}:* ${newTargetHealth}/${targetStats.maxHealth}\n`;

      if (targetDied) {
        // La víctima murió - aplicar cuota IMSS
        const freshTarget = db.getUser(targetJid);
        const imssResult = applyDeathPenalty(db, targetJid, freshTarget);

        db.updateUser(targetJid, { health: 1 }); // Revivir con 1 HP

        response += `\n💀 *¡${target.name} HA MUERTO!*\n`;
        response += generateIMSSMessage(imssResult, target.name);

        // Dar recompensa al atacante
        const expGain = randomInt(50, 150);
        const moneyGain = randomInt(100, 300);

        db.updateUser(m.sender, {
          exp: attacker.exp + expGain,
          money: attacker.money + moneyGain
        });

        response += `\n\n🎁 *Recompensa por el kill:*\n`;
        response += `   ${EMOJI.exp} +${expGain} XP\n`;
        response += `   ${EMOJI.coin} +${formatNumber(moneyGain)} monedas`;

      } else {
        db.updateUser(targetJid, { health: newTargetHealth });
      }

      await m.reply(response);
      await m.react('💥');
    }
  }
};

/**
 * Plugin: Pagar Deuda - Paga tu deuda con el IMSS
 */
export const pagarDeudaPlugin: PluginHandler = {
  command: ['pagardeuda', 'pagarimss', 'paydebt'],
  tags: ['rpg'],
  help: [
    'pagardeuda [cantidad] - Paga tu deuda con el IMSS',
    'Sin cantidad = paga todo lo que puedas',
    'Si no pagas, no podrás usar ciertas funciones'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (user.debt <= 0) {
      await m.reply(
        `${EMOJI.success} ¡No tienes deuda con el IMSS!\n\n` +
        `🏥 Tu historial crediticio está limpio.`
      );
      return;
    }

    // Determinar cantidad a pagar
    let amountToPay = user.debt;

    if (args[0]) {
      const specified = parseInt(args[0]);
      if (!isNaN(specified) && specified > 0) {
        amountToPay = Math.min(specified, user.debt);
      }
    }

    // Verificar si tiene dinero
    if (user.money <= 0) {
      await m.reply(
        `${EMOJI.error} ¡No tienes dinero para pagar!\n\n` +
        `💰 Tu dinero: *$0*\n` +
        `📋 Tu deuda: *$${formatNumber(user.debt)}*\n\n` +
        `💡 Trabaja, mina o roba para conseguir dinero.`
      );
      return;
    }

    // Pagar lo que se pueda
    const actualPayment = Math.min(amountToPay, user.money);
    const newDebt = user.debt - actualPayment;
    const newMoney = user.money - actualPayment;

    db.updateUser(m.sender, {
      money: newMoney,
      debt: newDebt
    });

    let response = `🏥 *PAGO DE DEUDA IMSS*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `💵 Pagaste: *$${formatNumber(actualPayment)}*\n`;
    response += `💰 Dinero restante: *$${formatNumber(newMoney)}*\n\n`;

    if (newDebt <= 0) {
      response += `✅ *¡DEUDA SALDADA!*\n`;
      response += `🎉 Ya no debes nada al IMSS.\n`;
      response += `_Gracias por ser un ciudadano responsable_`;
      await m.react('✅');
    } else {
      response += `📋 Deuda restante: *$${formatNumber(newDebt)}*\n`;
      response += `⚠️ _Sigue pagando para saldar tu deuda_`;
      await m.react('💸');
    }

    await m.reply(response);
  }
};

/**
 * Plugin: Ver Deuda - Consulta tu deuda con el IMSS
 */
export const verDeudaPlugin: PluginHandler = {
  command: ['deuda', 'debt', 'imss'],
  tags: ['rpg'],
  help: ['deuda - Consulta tu deuda con el IMSS'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let response = `🏥 *ESTADO DE CUENTA IMSS*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `👤 Paciente: *${user.name}*\n`;
    response += `📋 Deuda total: *$${formatNumber(user.debt)}*\n\n`;

    if (user.debt <= 0) {
      response += `✅ *Sin adeudos*\n`;
      response += `_Tu historial crediticio está limpio_`;
    } else if (user.debt < 1000) {
      response += `⚠️ *Deuda baja*\n`;
      response += `_Paga pronto para evitar problemas_`;
    } else if (user.debt < 5000) {
      response += `🔶 *Deuda moderada*\n`;
      response += `_El IMSS te está observando..._`;
    } else {
      response += `🔴 *DEUDA CRÍTICA*\n`;
      response += `_¡El IMSS enviará cobradores pronto!_`;
    }

    response += `\n\n💡 Usa */pagardeuda* para saldar tu deuda`;

    await m.reply(response);
  }
};

export default bombardearPlugin;
