import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime, randomInt, pickRandom, getTargetUser } from '../lib/utils.js';
import { COOLDOWNS, PVP } from '../constants/rpg.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { busyMessage, getBusy, grantCombatRewards, handlePlayerDeath } from '../lib/rpg-combat.js';

const SUCCESS_MESSAGES = [
  '💣💥 *{attacker}* lanzó una bomba a *{victim}* y le voló en pedazos!',
  '🧨💥 *{attacker}* bombardeó a *{victim}*! ¡BOOM!',
  '💣🔥 La bomba de *{attacker}* alcanzó a *{victim}*! ¡Explosión masiva!',
  '🎇💥 *{attacker}* le aventó una granada a *{victim}*! ¡Directo al blanco!',
  '💣☠️ *{victim}* no vio venir la bomba de *{attacker}*! ¡RIP!'
];

const BACKFIRE_MESSAGES = [
  '💣💥 ¡OOPS! La bomba de *{attacker}* le explotó en la cara!',
  '🧨🤡 *{attacker}* tiró mal la bomba y se voló a sí mismo!',
  '💣😵 La mecha estaba muy corta... *{attacker}* se hizo pedazos!',
  '🎇💀 *{attacker}* olvidó soltar la bomba... ¡BOOM en sus manos!',
  '💣🤦 *{attacker}* se tropezó y la bomba le cayó encima!'
];

export const bombardearPlugin: PluginHandler = {
  command: ['bombardear', 'bomba', 'bomb', 'granada'],
  tags: ['rpg'],
  help: [
    'bombardear @usuario - Lanza una bomba a otro jugador',
    `Cuidado: puede explotarte en la cara (${PVP.BACKFIRE_CHANCE}% probabilidad)`,
    'Si mueres, pagarás cuota del IMSS',
    `Cooldown: ${msToTime(COOLDOWNS.BOMB)}`
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const attacker = db.getUser(m.sender);
    const now = Date.now();

    const lastBomb = attacker.lastBomb || 0;
    if (now - lastBomb < COOLDOWNS.BOMB) {
      await m.reply(
        `${EMOJI.time} ¡Necesitas preparar más bombas!\n\n` +
        `⏳ Espera *${msToTime(COOLDOWNS.BOMB - (now - lastBomb))}* para bombardear de nuevo.`
      );
      return;
    }

    const attackerStats = calculateTotalStats(attacker);
    if (attacker.health < PVP.MIN_HEALTH_COMBAT) {
      await m.reply(
        `${EMOJI.error} ¡Estás muy débil para manejar explosivos!\n\n` +
        `❤️ Salud actual: *${attacker.health}/${attackerStats.maxHealth}*\n` +
        `💡 Usa una poción para curarte.`
      );
      return;
    }

    const targetJid = getTargetUser({ mentionedJid: m.mentionedJid, quoted: m.quoted, chat: m.chat, sender: m.sender }, { args, allowSelf: true });
    if (!targetJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres bombardear?\n\n` +
        `📝 *Uso:* ${usedPrefix}bombardear @usuario\n` +
        `⚠️ ¡Cuidado! ${PVP.BACKFIRE_CHANCE}% de probabilidad de explotarte a ti mismo`
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
    if (attacker.passiveMode && attacker.passiveModeUntil > now) {
      await m.reply(
        `${EMOJI.error} Estás en *modo pasivo*.\n\n` +
        `🕊️ No puedes bombardear a nadie mientras estés protegido.\n` +
        `💡 Usa *${usedPrefix}pasivo* para desactivarlo (cooldown de ${msToTime(COOLDOWNS.PASSIVE_MODE)}).`
      );
      return;
    }
    if (target.passiveMode && target.passiveModeUntil > now) {
      await m.reply(`🕊️ *${target.name}* está en *modo pasivo*.\n\nNo puedes bombardear a jugadores protegidos.`);
      return;
    }
    const targetBusy = getBusy(targetJid);
    if (targetBusy) {
      await m.reply(`${EMOJI.error} ${busyMessage(targetBusy, target.name)}`);
      return;
    }
    if (target.shieldBombas && target.shieldBombas > now) {
      await m.reply(
        `🧱 *¡${target.name} tiene un Escudo Antibombas activo!*\n\n` +
        `La bomba rebotó en el escudo y se desactivó.\n` +
        `⏳ Protección restante: *${msToTime(target.shieldBombas - now)}*\n\n` +
        `💡 Intenta con otra víctima o espera a que expire.`
      );
      await m.react('🧱');
      return;
    }

    await m.react('💣');
    db.updateUser(m.sender, { lastBomb: now });

    const bombDamage = randomInt(PVP.BOMB_DAMAGE.MIN, PVP.BOMB_DAMAGE.MAX);
    const isBackfire = randomInt(1, 100) <= PVP.BACKFIRE_CHANCE;

    if (isBackfire) {
      const newHealth = Math.max(0, attacker.health - bombDamage);
      let response = pickRandom(BACKFIRE_MESSAGES).replace(/{attacker}/g, attacker.name);
      response += `\n\n💥 *Daño recibido:* ${bombDamage}\n`;
      response += `❤️ *Salud:* ${newHealth}/${attackerStats.maxHealth}\n`;

      if (newHealth <= 0) {
        db.updateUser(m.sender, { health: 0 });
        response += `\n💀 *¡HAS MUERTO!*\n`;
        response += handlePlayerDeath(db, m.sender, attacker.name, now).message;
      } else {
        db.updateUser(m.sender, { health: newHealth });
      }

      await m.reply(response);
      await m.react('🤡');
      return;
    }

    const targetStats = calculateTotalStats(target);
    const newTargetHealth = Math.max(0, target.health - bombDamage);
    let response = pickRandom(SUCCESS_MESSAGES)
      .replace(/{attacker}/g, attacker.name)
      .replace(/{victim}/g, target.name);
    response += `\n\n💥 *Daño causado:* ${bombDamage}\n`;
    response += `❤️ *Salud de ${target.name}:* ${newTargetHealth}/${targetStats.maxHealth}\n`;

    if (newTargetHealth <= 0) {
      db.updateUser(targetJid, { health: 0 });
      response += `\n💀 *¡${target.name} HA MUERTO!*\n`;
      response += handlePlayerDeath(db, targetJid, target.name, now).message;

      const reward = grantCombatRewards(db, m.sender, {
        exp: randomInt(PVP.BOMB_KILL_REWARD.EXP.MIN, PVP.BOMB_KILL_REWARD.EXP.MAX),
        money: randomInt(PVP.BOMB_KILL_REWARD.MONEY.MIN, PVP.BOMB_KILL_REWARD.MONEY.MAX)
      }, now);
      response += `\n\n🎁 *Recompensa por el kill:*\n`;
      response += `   ${EMOJI.exp} +${reward.exp} XP\n`;
      response += `   ${EMOJI.coin} +${formatNumber(reward.money)} monedas`;
      if (reward.lines.length > 0) response += `\n${reward.lines.map(l => `   ${l}`).join('\n')}`;
    } else {
      db.updateUser(targetJid, { health: newTargetHealth });
    }

    await m.reply(response);
    await m.react('💥');
  }
};

export const pagarDeudaPlugin: PluginHandler = {
  command: ['pagardeuda', 'pagarimss', 'paydebt'],
  tags: ['rpg'],
  help: [
    'pagardeuda [cantidad] - Paga tu deuda con el IMSS',
    'Sin cantidad = paga todo lo que puedas'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (user.debt <= 0) {
      await m.reply(`${EMOJI.success} ¡No tienes deuda con el IMSS!\n\n🏥 Tu historial crediticio está limpio.`);
      return;
    }

    let amountToPay = user.debt;
    const specified = parseInt(args[0] ?? '', 10);
    if (Number.isFinite(specified) && specified > 0) amountToPay = Math.min(specified, user.debt);

    if (user.money <= 0) {
      await m.reply(
        `${EMOJI.error} ¡No tienes dinero para pagar!\n\n` +
        `💰 Tu dinero: *$0*\n📋 Tu deuda: *$${formatNumber(user.debt)}*\n\n` +
        `💡 Trabaja, mina o roba para conseguir dinero.`
      );
      return;
    }

    const payment = Math.min(amountToPay, user.money);
    const newDebt = user.debt - payment;
    const newMoney = user.money - payment;
    db.updateUser(m.sender, {
      money: newMoney,
      debt: newDebt,
      ...(newDebt <= 0 ? { debtCreatedAt: 0, debtInterestApplied: 0 } : {})
    });

    let response = `🏥 *PAGO DE DEUDA IMSS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `💵 Pagaste: *$${formatNumber(payment)}*\n`;
    response += `💰 Dinero restante: *$${formatNumber(newMoney)}*\n\n`;
    if (newDebt <= 0) {
      response += `✅ *¡DEUDA SALDADA!*\n🎉 Ya no debes nada al IMSS.\n_Gracias por ser un ciudadano responsable_`;
      await m.react('✅');
    } else {
      response += `📋 Deuda restante: *$${formatNumber(newDebt)}*\n⚠️ _Sigue pagando para saldar tu deuda_`;
      await m.react('💸');
    }
    await m.reply(response);
  }
};

export const verDeudaPlugin: PluginHandler = {
  command: ['deuda', 'debt', 'imss'],
  tags: ['rpg'],
  help: ['deuda - Consulta tu deuda con el IMSS'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let response = `🏥 *ESTADO DE CUENTA IMSS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `👤 Paciente: *${user.name}*\n`;
    response += `📋 Deuda total: *$${formatNumber(user.debt)}*\n\n`;
    if (user.debt <= 0) response += `✅ *Sin adeudos*\n_Tu historial crediticio está limpio_`;
    else if (user.debt < 1000) response += `⚠️ *Deuda baja*\n_Paga pronto para evitar problemas_`;
    else if (user.debt < 5000) response += `🔶 *Deuda moderada*\n_El IMSS te está observando..._`;
    else response += `🔴 *DEUDA CRÍTICA*\n_¡El IMSS enviará cobradores pronto!_`;
    if (user.seguroVida > Date.now()) response += `\n\n📜 Seguro de vida activo: *${msToTime(user.seguroVida - Date.now())}*`;
    response += `\n\n💡 Usa *${usedPrefix}pagardeuda* para saldar tu deuda`;

    await m.reply(response);
  }
};

export default bombardearPlugin;
