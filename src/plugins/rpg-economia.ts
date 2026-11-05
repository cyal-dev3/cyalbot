import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase, type Database } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom, parseAmount, msToTime, mentionTag } from '../lib/utils.js';
import type { UserRPG } from '../types/user.js';
import { COOLDOWNS } from '../constants/rpg.js';
import { isPassiveActive, isEnslaved, SLAVERY_CUT, PASSIVE_MODE_NO_EXPIRY, usageError } from '../lib/rpg-actions.js';
import { updateQuestProgress } from '../lib/quests.js';

export { isPassiveActive, SLAVERY_CUT };

/** Tiempo que el dinero del banco queda protegido tras cada depósito */
export const BANK_DURATION = 24 * 60 * 60 * 1000;
/** Tope de saldo en el banco: no se puede depositar por encima */
export const BANK_MAX_AMOUNT = 100000;
export const TRANSFER_MIN_COMMISSION = 1;
export const TRANSFER_MAX_COMMISSION = 15;
export const SLAVERY_DURATION = 4 * 60 * 60 * 1000;
export const SLAVERY_COST = 10000;
export const MAX_SLAVES = 3;
export const DEBT_INTEREST_RATE = 0.05;
export const DEBT_INTEREST_INTERVAL = 24 * 60 * 60 * 1000;
export const DEBT_SEIZURE_THRESHOLD = 20000;

const TRANSFER_MESSAGES = [
  '💸 *{sender}* le transfirió *${amount}* cyalopesos a *{receiver}*!',
  '💰 *{sender}* envió *${amount}* cyalopesos a *{receiver}*!',
  '🏦 Transferencia exitosa: *{sender}* → *{receiver}*: *${amount}* cyalopesos',
  '💵 *{receiver}* recibió *${amount}* cyalopesos de *{sender}*!'
];

const SLAVERY_MESSAGES = [
  '⛓️ *{victim}* ahora es esclavo de *{master}* por 4 horas!',
  '🔗 *{master}* ha esclavizado a *{victim}*! Sus ganancias ahora son compartidas.',
  '👑 *{master}* es ahora el amo de *{victim}*. ¡A trabajar, esclavo!',
  '⚔️ *{victim}* perdió su libertad ante *{master}* por las próximas 4 horas!'
];

/**
 * Deja coherentes los timestamps de la deuda: si hay deuda y faltan, se fijan a
 * `now`; si ya no hay deuda, se limpian para que una deuda futura no arrastre
 * intereses de la anterior. Muta `user`; devuelve true si cambió algo.
 */
export function ensureDebtTimestamps(user: UserRPG, now: number = Date.now()): boolean {
  if (user.debt > 0) {
    let changed = false;
    if (!user.debtCreatedAt) {
      user.debtCreatedAt = now;
      changed = true;
    }
    if (!user.debtInterestApplied) {
      user.debtInterestApplied = user.debtCreatedAt;
      changed = true;
    }
    return changed;
  }
  if (user.debtCreatedAt || user.debtInterestApplied) {
    user.debtCreatedAt = 0;
    user.debtInterestApplied = 0;
    return true;
  }
  return false;
}

export interface DebtInterestResult {
  interestApplied: boolean;
  interestAmount: number;
  newDebt: number;
  itemsSeized: string[];
}

/**
 * Aplica el interés diario acumulado desde la última aplicación. El timestamp
 * avanza solo los periodos cobrados, así no se pierde la fracción de día.
 */
export function applyDebtInterest(db: Database, jid: string, user: UserRPG, now: number = Date.now()): DebtInterestResult {
  const result: DebtInterestResult = { interestApplied: false, interestAmount: 0, newDebt: user.debt, itemsSeized: [] };

  if (ensureDebtTimestamps(user, now)) {
    db.updateUser(jid, { debtCreatedAt: user.debtCreatedAt, debtInterestApplied: user.debtInterestApplied });
  }
  if (user.debt <= 0) return result;

  const periods = Math.floor((now - user.debtInterestApplied) / DEBT_INTEREST_INTERVAL);
  if (periods <= 0) return result;

  // Interés simple por periodo sobre la deuda al inicio del tramo
  const interestAmount = Math.floor(user.debt * DEBT_INTEREST_RATE * periods);
  const newDebt = user.debt + interestAmount;
  const updates: Partial<UserRPG> = {
    debt: newDebt,
    debtInterestApplied: user.debtInterestApplied + periods * DEBT_INTEREST_INTERVAL
  };

  if (newDebt >= DEBT_SEIZURE_THRESHOLD && user.inventory.length > 0) {
    const index = randomInt(0, user.inventory.length - 1);
    result.itemsSeized.push(user.inventory[index].itemId);
    updates.inventory = user.inventory.filter((_, i) => i !== index);
  }

  db.updateUser(jid, updates);
  result.interestApplied = true;
  result.interestAmount = interestAmount;
  result.newDebt = newDebt;
  return result;
}

/** Esclavos vigentes que siguen reconociendo a `jid` como amo */
export function getActiveSlaves(db: Database, jid: string, now: number = Date.now()): string[] {
  const user = db.getUser(jid);
  return user.slaves.filter(slaveJid => {
    const slave = db.getUser(slaveJid);
    return slave.slaveMaster === jid && slave.slaveUntil > now;
  });
}

export type AmountResolution = { amount: number } | { error: string };

/** Cantidad a depositar respetando efectivo y el tope del banco */
export function resolveDepositAmount(user: UserRPG, raw: string | undefined): AmountResolution {
  const room = Math.max(0, BANK_MAX_AMOUNT - user.bank);
  const amount = parseAmount(raw, Math.min(user.money, room));
  if (amount === null || amount <= 0) return { error: 'Cantidad inválida.' };
  if (amount > user.money) return { error: `No tienes suficiente efectivo (tienes $${formatNumber(user.money)}).` };
  if (room <= 0) return { error: `Tu banco ya está al tope de $${formatNumber(BANK_MAX_AMOUNT)}.` };
  if (amount > room) return { error: `Solo caben $${formatNumber(room)} más (tope $${formatNumber(BANK_MAX_AMOUNT)}).` };
  return { amount };
}

/** Cantidad a retirar; sin argumento retira todo */
export function resolveWithdrawAmount(user: UserRPG, raw: string | undefined): AmountResolution {
  if (user.bank <= 0) return { error: 'No tienes dinero en el banco.' };
  const amount = raw ? parseAmount(raw, user.bank) : user.bank;
  if (amount === null || amount <= 0) return { error: 'Cantidad inválida.' };
  if (amount > user.bank) return { error: `Solo tienes $${formatNumber(user.bank)} en el banco.` };
  return { amount };
}

export function resolveTransferAmount(sender: UserRPG, raw: string | undefined): AmountResolution {
  const amount = parseAmount(raw, sender.money);
  if (amount === null || amount <= 0) return { error: 'Cantidad inválida.' };
  if (amount > sender.money) return { error: `No tienes suficiente efectivo (tienes $${formatNumber(sender.money)}; el banco no se transfiere).` };
  return { amount };
}

/** Comisión esperada de una transferencia (media del rango aleatorio), en % */
export const TRANSFER_EXPECTED_COMMISSION = Math.round((TRANSFER_MIN_COMMISSION + TRANSFER_MAX_COMMISSION) / 2);

async function notifyDebtInterest(ctx: MessageContext, result: DebtInterestResult): Promise<void> {
  if (!result.interestApplied) return;
  await ctx.m.reply(
    `⚠️ *AVISO DEL IMSS*\n\n` +
    `Se han aplicado intereses a tu deuda:\n` +
    `📈 Interés: +$${formatNumber(result.interestAmount)}\n` +
    `📋 Deuda total: $${formatNumber(result.newDebt)}` +
    (result.itemsSeized.length > 0 ? `\n\n🚨 *CONFISCACIÓN:* El IMSS confiscó: ${result.itemsSeized.join(', ')}` : '')
  );
}

export const bancoPlugin: PluginHandler = {
  command: ['banco', 'bank', 'depositar'],
  tags: ['rpg'],
  help: [
    'banco - Ver tu saldo bancario',
    'banco depositar <cantidad> - Depositar (también: banco 5000)',
    'banco retirar [cantidad] - Retirar (sin cantidad retira todo)',
    `El dinero del banco está protegido de robos ${BANK_DURATION / 3600000}h tras cada depósito`,
    `Tope del banco: $${formatNumber(BANK_MAX_AMOUNT)}. Cantidades: 5000, 1k, 50%, todo, mitad`
  ],
  usage: ['banco', 'banco depositar <cantidad>', 'banco retirar [cantidad]'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, command, usedPrefix } = ctx;
    const db = getDatabase();
    const now = Date.now();

    await notifyDebtInterest(ctx, applyDebtInterest(db, m.sender, db.getUser(m.sender), now));
    const user = db.getUser(m.sender);

    // "/depositar 5000" y "/banco 5000" son atajos de "banco depositar 5000"
    let action = (args[0] ?? '').toLowerCase();
    let rawAmount = args[1];
    if (command.toLowerCase() === 'depositar' && action !== 'retirar' && action !== 'ver') {
      rawAmount = args[0];
      action = 'depositar';
    } else if (action && parseAmount(action, user.money) !== null) {
      rawAmount = action;
      action = 'depositar';
    }

    if (!action || action === 'ver' || action === 'saldo') {
      const protectedUntil = user.bankDepositTime + BANK_DURATION;
      let text = `🏦 *BANCO CYALTRONIC*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 Titular: *${user.name}*\n` +
        `💰 Efectivo: *$${formatNumber(user.money)}*\n` +
        `🏦 En banco: *$${formatNumber(user.bank)}* / $${formatNumber(BANK_MAX_AMOUNT)}\n\n`;

      if (user.bank > 0) {
        text += now < protectedUntil
          ? `🛡️ *Protección activa* · ⏳ ${msToTime(protectedUntil - now)}\n_Tu dinero está seguro_`
          : `⚠️ *Protección expirada*\n_Vuelve a depositar para renovarla_`;
      } else {
        text += `💡 Usa *${usedPrefix}banco depositar <cantidad>* para proteger tu dinero`;
      }
      return m.reply(text);
    }

    if (['retirar', 'sacar', 'withdraw'].includes(action)) {
      const resolved = resolveWithdrawAmount(user, rawAmount);
      if ('error' in resolved) return usageError(ctx, bancoPlugin, resolved.error);

      // Saldos calculados antes de updateUser: `user` es la referencia viva de la BD
      const newMoney = user.money + resolved.amount;
      const newBank = user.bank - resolved.amount;
      db.updateUser(m.sender, {
        money: newMoney,
        bank: newBank,
        bankDepositTime: newBank > 0 ? user.bankDepositTime : 0
      });

      await m.reply(
        `🏦 *RETIRO EXITOSO*\n\n` +
        `💵 Retiraste: *$${formatNumber(resolved.amount)}*\n` +
        `💰 Efectivo: *$${formatNumber(newMoney)}*\n` +
        `🏦 Queda en banco: *$${formatNumber(newBank)}*\n\n` +
        `⚠️ _El efectivo no está protegido de robos_`
      );
      return m.react('💵');
    }

    if (['depositar', 'deposit'].includes(action)) {
      const resolved = resolveDepositAmount(user, rawAmount);
      if ('error' in resolved) return usageError(ctx, bancoPlugin, resolved.error);

      const newMoney = user.money - resolved.amount;
      const newBank = user.bank + resolved.amount;
      db.updateUser(m.sender, { money: newMoney, bank: newBank, bankDepositTime: now });

      await m.reply(
        `🏦 *DEPÓSITO EXITOSO*\n\n` +
        `💵 Depositaste: *$${formatNumber(resolved.amount)}*\n` +
        `🏦 Saldo en banco: *$${formatNumber(newBank)}* / $${formatNumber(BANK_MAX_AMOUNT)}\n` +
        `💰 Efectivo restante: *$${formatNumber(newMoney)}*\n\n` +
        `🛡️ *Protegido de robos por ${BANK_DURATION / 3600000}h*`
      );
      return m.react('🏦');
    }

    return usageError(ctx, bancoPlugin);
  }
};

export const transferirPlugin: PluginHandler = {
  command: ['transferir', 'transfer', 'enviar', 'pay'],
  tags: ['rpg'],
  help: [
    'transferir @usuario <cantidad> - Transfiere cyalopesos (1k, 50%, todo...)',
    `Comisión aleatoria del ${TRANSFER_MIN_COMMISSION}% al ${TRANSFER_MAX_COMMISSION}% (≈${TRANSFER_EXPECTED_COMMISSION}%)`,
    'Solo se transfiere efectivo, no el dinero del banco'
  ],
  usage: ['transferir @usuario <cantidad>'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const sender = db.getUser(m.sender);

    const targetJid = ctx.target();
    if (!targetJid) return usageError(ctx, transferirPlugin, '¿A quién quieres transferir? Menciona o responde a alguien.');

    const receiver = db.getUser(targetJid);
    if (!receiver.registered) return m.reply(`${EMOJI.error} Ese usuario no está registrado.`);

    const rawAmount = args.find(arg => !arg.startsWith('@'));
    const resolved = resolveTransferAmount(sender, rawAmount);
    if ('error' in resolved) {
      return usageError(ctx, transferirPlugin, `${resolved.error} Comisión esperada: ≈${TRANSFER_EXPECTED_COMMISSION}%.`);
    }

    const commissionRate = randomInt(TRANSFER_MIN_COMMISSION, TRANSFER_MAX_COMMISSION);
    const commission = Math.floor(resolved.amount * commissionRate / 100);
    const finalAmount = resolved.amount - commission;

    const senderBalance = sender.money - resolved.amount;
    db.updateUser(m.sender, { money: senderBalance });
    db.updateUser(targetJid, { money: receiver.money + finalAmount });
    const questLines = updateQuestProgress(db, m.sender, 'transfer', resolved.amount).lines;

    const message = pickRandom(TRANSFER_MESSAGES)
      .replace(/{sender}/g, sender.name)
      .replace(/{receiver}/g, mentionTag(targetJid))
      .replace(/{amount}/g, formatNumber(finalAmount));

    await ctx.send({
      text: `${message}\n\n` +
        `📊 *DETALLE DE TRANSFERENCIA*\n━━━━━━━━━━━━━━━━━━━━━\n` +
        `💵 Monto enviado: *$${formatNumber(resolved.amount)}*\n` +
        `📉 Comisión (${commissionRate}%): *-$${formatNumber(commission)}*\n` +
        `✅ Monto recibido: *$${formatNumber(finalAmount)}*\n\n` +
        `💰 Tu nuevo saldo: *$${formatNumber(senderBalance)}*` +
        (questLines.length ? `\n\n${questLines.join('\n')}` : ''),
      mentions: [targetJid]
    });
    await m.react('💸');
  }
};

export const esclavizarPlugin: PluginHandler = {
  command: ['esclavizar', 'enslave', 'slave'],
  tags: ['rpg'],
  help: [
    `esclavizar @usuario - Esclaviza a otro jugador por ${SLAVERY_DURATION / 3600000} horas`,
    `Costo: $${formatNumber(SLAVERY_COST)}. Recibes el ${SLAVERY_CUT}% de lo que gane tu esclavo`,
    `Máximo ${MAX_SLAVES} esclavos. No funciona con jugadores en modo pasivo`
  ],
  usage: ['esclavizar @usuario'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const master = db.getUser(m.sender);
    const now = Date.now();

    if (isPassiveActive(master, now)) {
      return m.reply(
        `${EMOJI.error} Estás en *modo pasivo*.\n\n` +
        `🕊️ No puedes esclavizar a nadie mientras estés protegido.\n` +
        `💡 Usa *${usedPrefix}pasivo* para desactivarlo.`
      );
    }

    const activeSlaves = getActiveSlaves(db, m.sender, now);
    if (activeSlaves.length >= MAX_SLAVES) {
      return m.reply(
        `${EMOJI.error} Ya tienes el máximo de esclavos (${MAX_SLAVES}).\n\n` +
        `⏳ Espera a que expire la esclavitud de alguno.`
      );
    }

    const targetJid = ctx.target({ args });
    if (!targetJid) return usageError(ctx, esclavizarPlugin, '¿A quién quieres esclavizar?');

    const target = db.getUser(targetJid);
    if (!target.registered) return m.reply(`${EMOJI.error} Ese jugador no está registrado.`);

    if (isPassiveActive(target, now)) {
      return m.reply(`🕊️ *${target.name}* está en *modo pasivo*. No puedes esclavizar a jugadores protegidos.`);
    }

    if (isEnslaved(target, now) && target.slaveMaster) {
      const currentMaster = db.getUser(target.slaveMaster);
      return m.reply(
        `⛓️ *${target.name}* ya es esclavo de *${currentMaster.name}*.\n` +
        `⏳ Esclavitud expira en: *${msToTime(target.slaveUntil - now)}*`
      );
    }

    if (isEnslaved(master, now) && master.slaveMaster === targetJid) {
      return m.reply(
        `${EMOJI.error} No puedes esclavizar a tu amo.\n\n` +
        `⛓️ *${target.name}* es tu dueño actual. Primero compra tu libertad con *${usedPrefix}liberar*.`
      );
    }

    if (master.money < SLAVERY_COST) {
      return m.reply(
        `${EMOJI.error} No tienes suficiente dinero.\n\n` +
        `💰 Tu dinero: *$${formatNumber(master.money)}*\n` +
        `💵 Costo: *$${formatNumber(SLAVERY_COST)}*`
      );
    }

    db.updateUser(m.sender, { money: master.money - SLAVERY_COST, slaves: [...activeSlaves, targetJid] });
    db.updateUser(targetJid, { slaveMaster: m.sender, slaveUntil: now + SLAVERY_DURATION });
    const questLines = updateQuestProgress(db, m.sender, 'spend', SLAVERY_COST).lines;

    const message = pickRandom(SLAVERY_MESSAGES)
      .replace(/{master}/g, master.name)
      .replace(/{victim}/g, mentionTag(targetJid));

    await ctx.send({
      text: `${message}\n\n` +
        `⛓️ *CONTRATO DE ESCLAVITUD*\n━━━━━━━━━━━━━━━━━━━━━\n` +
        `👑 Amo: *${master.name}*\n` +
        `🔗 Esclavo: *${target.name}*\n` +
        `⏳ Duración: *${msToTime(SLAVERY_DURATION)}*\n` +
        `💰 Costo pagado: *$${formatNumber(SLAVERY_COST)}*\n\n` +
        `📊 Recibirás el *${SLAVERY_CUT}%* de todo lo que gane (work, minar, daily, pescar, cazar...).\n` +
        `💡 _El esclavo puede liberarse pagando $${formatNumber(SLAVERY_COST * 2)}_` +
        (questLines.length ? `\n\n${questLines.join('\n')}` : ''),
      mentions: [targetJid]
    });
    await m.react('⛓️');
  }
};

export const liberarPlugin: PluginHandler = {
  command: ['liberar', 'free', 'liberarse', 'libertad'],
  tags: ['rpg'],
  help: [
    `liberar - Compra tu libertad (costo: $${formatNumber(SLAVERY_COST * 2)})`,
    'Solo funciona si eres esclavo de alguien'
  ],
  usage: ['liberar'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    if (!isEnslaved(user, now) || !user.slaveMaster) {
      return m.reply(`${EMOJI.success} ¡Ya eres libre!\n\n🕊️ No tienes ningún amo que te esclavice.`);
    }

    const freedomCost = SLAVERY_COST * 2;
    const master = db.getUser(user.slaveMaster);

    if (user.money < freedomCost) {
      return m.reply(
        `${EMOJI.error} No tienes suficiente dinero para comprar tu libertad.\n\n` +
        `⛓️ Amo actual: *${master.name}*\n` +
        `💰 Tu dinero: *$${formatNumber(user.money)}*\n` +
        `💵 Costo de libertad: *$${formatNumber(freedomCost)}*\n` +
        `⏳ Esclavitud expira en: *${msToTime(user.slaveUntil - now)}*`
      );
    }

    const masterJid = user.slaveMaster;
    const moneyLeft = user.money - freedomCost;
    db.updateUser(m.sender, { money: moneyLeft, slaveMaster: null, slaveUntil: 0 });
    db.updateUser(masterJid, { slaves: master.slaves.filter(s => s !== m.sender) });
    const questLines = updateQuestProgress(db, m.sender, 'spend', freedomCost).lines;

    await m.reply(
      `🕊️ *¡LIBERTAD!*\n\n` +
      `Has comprado tu libertad de *${master.name}*.\n\n` +
      `💵 Pagaste: *$${formatNumber(freedomCost)}*\n` +
      `💰 Dinero restante: *$${formatNumber(moneyLeft)}*` +
      (questLines.length ? `\n\n${questLines.join('\n')}` : '')
    );
    await m.react('🕊️');
  }
};

export const esclavosPlugin: PluginHandler = {
  command: ['esclavos', 'slaves', 'misesclavos'],
  tags: ['rpg'],
  help: ['esclavos - Ve tu lista de esclavos actuales'],
  usage: ['esclavos'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const now = Date.now();
    const activeSlaves = getActiveSlaves(db, m.sender, now);

    if (activeSlaves.length === 0) {
      return m.reply(
        `⛓️ *TUS ESCLAVOS*\n\nNo tienes esclavos actualmente.\n\n` +
        `💡 Usa *${usedPrefix}esclavizar @usuario* (costo $${formatNumber(SLAVERY_COST)}).`
      );
    }

    const list = activeSlaves.map(jid => {
      const slave = db.getUser(jid);
      return `🔗 *${slave.name}* · ⏳ ${msToTime(slave.slaveUntil - now)}`;
    }).join('\n');

    await m.reply(
      `⛓️ *TUS ESCLAVOS (${activeSlaves.length}/${MAX_SLAVES})*\n━━━━━━━━━━━━━━━━━━━━━\n\n${list}\n\n` +
      `📊 Recibes el ${SLAVERY_CUT}% de todas sus ganancias.`
    );
  }
};

export const pasivoPlugin: PluginHandler = {
  command: ['pasivo', 'passive', 'pacifico', 'paz'],
  tags: ['rpg'],
  help: [
    'pasivo - Activa/desactiva el modo pasivo (también: pasivo on|off)',
    'En modo pasivo no puedes robar, bombardear ni esclavizar, ni te lo pueden hacer a ti',
    `Cooldown de ${COOLDOWNS.PASSIVE_MODE / 3600000} horas entre cambios`
  ],
  usage: ['pasivo', 'pasivo on', 'pasivo off'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();
    const current = isPassiveActive(user, now);

    const wanted = (args[0] ?? '').toLowerCase();
    const newMode = ['on', 'si', 'sí', 'activar'].includes(wanted) ? true
      : ['off', 'no', 'desactivar'].includes(wanted) ? false
      : !current;

    if (newMode === current) {
      return m.reply(`${EMOJI.info} Tu modo pasivo ya está *${current ? 'activado' : 'desactivado'}*.`);
    }

    if (user.passiveModeChangedAt > 0 && now - user.passiveModeChangedAt < COOLDOWNS.PASSIVE_MODE) {
      return m.reply(
        `${EMOJI.time} *COOLDOWN ACTIVO*\n\n` +
        `🕊️ Estado actual: *${current ? 'Pasivo' : 'Activo'}*\n` +
        `⏳ Puedes cambiar en: *${msToTime(COOLDOWNS.PASSIVE_MODE - (now - user.passiveModeChangedAt))}*`
      );
    }

    if (isEnslaved(user, now)) {
      return m.reply(
        `${EMOJI.error} No puedes cambiar el modo pasivo siendo esclavo.\n\n` +
        `⛓️ Primero compra tu libertad con *${usedPrefix}liberar*`
      );
    }

    // PASSIVE_MODE_NO_EXPIRY mantiene coherentes a los lectores que exigen passiveModeUntil > now
    db.updateUser(m.sender, {
      passiveMode: newMode,
      passiveModeUntil: newMode ? PASSIVE_MODE_NO_EXPIRY : 0,
      passiveModeChangedAt: now
    });

    if (newMode) {
      await m.reply(
        `🕊️ *MODO PASIVO ACTIVADO*\n\n` +
        `No puedes robar, bombardear ni esclavizar, y nadie puede hacértelo a ti.\n` +
        `⏳ Podrás desactivarlo en *${msToTime(COOLDOWNS.PASSIVE_MODE)}*.`
      );
      return m.react('🕊️');
    }

    await m.reply(
      `⚔️ *MODO PASIVO DESACTIVADO*\n\n` +
      `Vuelves a poder robar, bombardear y esclavizar... y a ser objetivo.\n` +
      `⏳ Podrás reactivarlo en *${msToTime(COOLDOWNS.PASSIVE_MODE)}*.`
    );
    await m.react('⚔️');
  }
};

export const estadoEconomiaPlugin: PluginHandler = {
  command: ['economia', 'economy', 'mieconomia', 'wallet'],
  tags: ['rpg'],
  help: ['economia - Ve tu estado económico completo'],
  usage: ['economia'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const now = Date.now();

    await notifyDebtInterest(ctx, applyDebtInterest(db, m.sender, db.getUser(m.sender), now));
    const user = db.getUser(m.sender);

    let text = `💰 *ESTADO ECONÓMICO*\n━━━━━━━━━━━━━━━━━━━━━\n\n👤 *${user.name}*\n\n`;
    text += `💵 *FINANZAS:*\n`;
    text += `• Efectivo: *$${formatNumber(user.money)}*\n`;
    text += `• Banco: *$${formatNumber(user.bank)}*\n`;
    text += `• Diamantes: *💎${formatNumber(user.limit)}*\n`;
    text += `• Total ganado: *$${formatNumber(user.totalEarned)}*\n`;
    if (user.debt > 0) {
      text += `• ⚠️ Deuda IMSS: *$${formatNumber(user.debt)}* (+${DEBT_INTEREST_RATE * 100}% cada 24h)\n`;
    }

    const passive = isPassiveActive(user, now);
    // Pasivos anteriores al cambio a "sin caducidad" conservan su fecha de 30 días
    const passiveExpiry = passive && user.passiveModeUntil !== PASSIVE_MODE_NO_EXPIRY
      ? ` (expira en ${msToTime(user.passiveModeUntil - now)})`
      : '';
    text += `\n🛡️ *ESTADO:*\n• Modo: *${passive ? '🕊️ Pasivo' : '⚔️ Activo'}*${passiveExpiry}\n`;

    if (isEnslaved(user, now) && user.slaveMaster) {
      const master = db.getUser(user.slaveMaster);
      text += `• ⛓️ Esclavo de: *${master.name}* (expira en ${msToTime(user.slaveUntil - now)})\n`;
    }

    const activeSlaves = getActiveSlaves(db, m.sender, now);
    if (activeSlaves.length > 0) {
      text += `• 👑 Esclavos: *${activeSlaves.length}/${MAX_SLAVES}*\n`;
    }

    const protections: string[] = [];
    if (user.bank > 0 && now < user.bankDepositTime + BANK_DURATION) {
      protections.push(`• 🏦 Banco protegido: *${msToTime(user.bankDepositTime + BANK_DURATION - now)}*`);
    }
    if (user.shieldRobo > now) protections.push(`• 🛡️ Anti-robo: *${msToTime(user.shieldRobo - now)}*`);
    if (user.shieldBombas > now) protections.push(`• 🧱 Anti-bombas: *${msToTime(user.shieldBombas - now)}*`);
    if (user.seguroVida > now) protections.push(`• 📜 Seguro de vida: *${msToTime(user.seguroVida - now)}*`);

    text += `\n🛡️ *PROTECCIONES:*\n` + (protections.length ? protections.join('\n') : '• _Ninguna activa_');

    await m.reply(text);
  }
};

export default bancoPlugin;
