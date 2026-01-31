/**
 * Plugin de Economía Avanzada - RPG
 * Comandos: banco, transferir, esclavizar, pasivo
 * Sistema de economía extendido con protección, esclavitud y modo pasivo
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import type { UserRPG } from '../types/user.js';

// Constantes de economía
const BANK_DURATION = 24 * 60 * 60 * 1000; // 24 horas
const BANK_MAX_AMOUNT = 100000; // Máximo a depositar
const TRANSFER_MIN_COMMISSION = 1; // 1% mínimo
const TRANSFER_MAX_COMMISSION = 15; // 15% máximo
const PASSIVE_MODE_COOLDOWN = 6 * 60 * 60 * 1000; // 6 horas para cambiar modo
const SLAVERY_DURATION = 4 * 60 * 60 * 1000; // 4 horas de esclavitud
const SLAVERY_COST = 10000; // Costo para esclavizar
const SLAVERY_CUT = 50; // 50% del trabajo del esclavo va al dueño
const DEBT_INTEREST_RATE = 0.05; // 5% de interés diario
const DEBT_INTEREST_INTERVAL = 24 * 60 * 60 * 1000; // Cada 24 horas
const DEBT_SEIZURE_THRESHOLD = 20000; // Si la deuda supera esto, se confiscan items

/**
 * Mensajes de transferencia
 */
const TRANSFER_MESSAGES = [
  '💸 *{sender}* le transfirió *${amount}* cyalopesos a *{receiver}*!',
  '💰 *{sender}* envió *${amount}* cyalopesos a *{receiver}*!',
  '🏦 Transferencia exitosa: *{sender}* → *{receiver}*: *${amount}* cyalopesos',
  '💵 *{receiver}* recibió *${amount}* cyalopesos de *{sender}*!'
];

/**
 * Mensajes de esclavitud
 */
const SLAVERY_MESSAGES = [
  '⛓️ *{victim}* ahora es esclavo de *{master}* por 4 horas!',
  '🔗 *{master}* ha esclavizado a *{victim}*! Sus ganancias ahora son compartidas.',
  '👑 *{master}* es ahora el amo de *{victim}*. ¡A trabajar, esclavo!',
  '⚔️ *{victim}* perdió su libertad ante *{master}* por las próximas 4 horas!'
];

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
 * Aplica intereses a la deuda si corresponde
 */
export function applyDebtInterest(db: ReturnType<typeof getDatabase>, userJid: string, user: UserRPG): {
  interestApplied: boolean;
  interestAmount: number;
  newDebt: number;
  itemsSeized: string[];
} {
  const now = Date.now();
  const result = {
    interestApplied: false,
    interestAmount: 0,
    newDebt: user.debt,
    itemsSeized: [] as string[]
  };

  // No hay deuda
  if (user.debt <= 0) return result;

  // Verificar si debemos aplicar intereses
  const lastInterest = user.debtInterestApplied || user.debtCreatedAt || now;
  const timeSinceInterest = now - lastInterest;

  if (timeSinceInterest >= DEBT_INTEREST_INTERVAL) {
    // Calcular cuántos períodos de interés han pasado
    const periods = Math.floor(timeSinceInterest / DEBT_INTEREST_INTERVAL);
    const interestAmount = Math.floor(user.debt * DEBT_INTEREST_RATE * periods);
    const newDebt = user.debt + interestAmount;

    result.interestApplied = true;
    result.interestAmount = interestAmount;
    result.newDebt = newDebt;

    // Confiscar items si la deuda es muy alta
    if (newDebt >= DEBT_SEIZURE_THRESHOLD && user.inventory.length > 0) {
      // Confiscar un item aleatorio
      const randomIndex = randomInt(0, user.inventory.length - 1);
      const seizedItem = user.inventory[randomIndex];
      result.itemsSeized.push(seizedItem.itemId);

      // Remover item del inventario
      const newInventory = [...user.inventory];
      newInventory.splice(randomIndex, 1);

      db.updateUser(userJid, {
        debt: newDebt,
        debtInterestApplied: now,
        inventory: newInventory
      });
    } else {
      db.updateUser(userJid, {
        debt: newDebt,
        debtInterestApplied: now
      });
    }
  }

  return result;
}

/**
 * Plugin: Banco - Deposita dinero protegido por 24h
 */
export const bancoPlugin: PluginHandler = {
  command: ['banco', 'bank', 'depositar'],
  tags: ['rpg'],
  help: [
    'banco <cantidad> - Deposita dinero en el banco',
    'banco retirar - Retira todo tu dinero del banco',
    'banco ver - Ve tu saldo bancario',
    'El dinero en el banco está protegido de robos por 24h',
    'Máximo a depositar: $100,000'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    // Verificar y aplicar intereses a la deuda
    const debtResult = applyDebtInterest(db, m.sender, user);
    if (debtResult.interestApplied) {
      await m.reply(
        `⚠️ *AVISO DEL IMSS*\n\n` +
        `Se han aplicado intereses a tu deuda:\n` +
        `📈 Interés: +$${formatNumber(debtResult.interestAmount)}\n` +
        `📋 Deuda total: $${formatNumber(debtResult.newDebt)}\n` +
        (debtResult.itemsSeized.length > 0
          ? `\n🚨 *CONFISCACIÓN:* El IMSS confiscó: ${debtResult.itemsSeized.join(', ')}`
          : '')
      );
    }

    // Refrescar usuario después de aplicar intereses
    const freshUser = db.getUser(m.sender);

    const action = args[0]?.toLowerCase();

    // Ver saldo bancario
    if (!action || action === 'ver' || action === 'saldo') {
      const bankExpired = freshUser.bankDepositTime > 0 && now > freshUser.bankDepositTime + BANK_DURATION;
      const timeLeft = freshUser.bankDepositTime > 0
        ? Math.max(0, (freshUser.bankDepositTime + BANK_DURATION) - now)
        : 0;
      const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));

      let response = `🏦 *BANCO CYALTRONIC*\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
      response += `👤 Titular: *${freshUser.name}*\n`;
      response += `💰 Efectivo: *$${formatNumber(freshUser.money)}*\n`;
      response += `🏦 En banco: *$${formatNumber(freshUser.bank)}*\n\n`;

      if (freshUser.bank > 0) {
        if (bankExpired) {
          response += `⚠️ *Protección expirada*\n`;
          response += `_Tu dinero ya puede ser robado_\n`;
          response += `💡 Retíralo o deposita de nuevo`;
        } else {
          response += `🛡️ *Protección activa*\n`;
          response += `⏳ Tiempo restante: *${hoursLeft}h*\n`;
          response += `_Tu dinero está seguro_`;
        }
      } else {
        response += `💡 Usa */banco <cantidad>* para depositar`;
      }

      await m.reply(response);
      return;
    }

    // Retirar dinero
    if (action === 'retirar' || action === 'withdraw' || action === 'sacar') {
      if (freshUser.bank <= 0) {
        await m.reply(`${EMOJI.error} No tienes dinero en el banco para retirar.`);
        return;
      }

      const amountToWithdraw = freshUser.bank;
      db.updateUser(m.sender, {
        money: freshUser.money + amountToWithdraw,
        bank: 0,
        bankDepositTime: 0
      });

      await m.reply(
        `🏦 *RETIRO EXITOSO*\n\n` +
        `💵 Retiraste: *$${formatNumber(amountToWithdraw)}*\n` +
        `💰 Nuevo saldo en efectivo: *$${formatNumber(freshUser.money + amountToWithdraw)}*\n\n` +
        `⚠️ _Tu dinero ya no está protegido de robos_`
      );
      await m.react('💵');
      return;
    }

    // Depositar dinero
    const amount = parseInt(args[0]);

    if (isNaN(amount) || amount <= 0) {
      await m.reply(
        `${EMOJI.error} Cantidad inválida.\n\n` +
        `📝 *Uso:*\n` +
        `• /banco <cantidad> - Depositar\n` +
        `• /banco retirar - Retirar todo\n` +
        `• /banco ver - Ver saldo`
      );
      return;
    }

    if (amount > freshUser.money) {
      await m.reply(
        `${EMOJI.error} No tienes suficiente dinero.\n\n` +
        `💰 Tu dinero: *$${formatNumber(freshUser.money)}*\n` +
        `💵 Intentas depositar: *$${formatNumber(amount)}*`
      );
      return;
    }

    const newBankTotal = freshUser.bank + amount;
    if (newBankTotal > BANK_MAX_AMOUNT) {
      await m.reply(
        `${EMOJI.error} Excedes el límite del banco.\n\n` +
        `🏦 En banco: *$${formatNumber(freshUser.bank)}*\n` +
        `📊 Límite máximo: *$${formatNumber(BANK_MAX_AMOUNT)}*\n` +
        `💵 Puedes depositar hasta: *$${formatNumber(BANK_MAX_AMOUNT - freshUser.bank)}*`
      );
      return;
    }

    db.updateUser(m.sender, {
      money: freshUser.money - amount,
      bank: newBankTotal,
      bankDepositTime: now
    });

    await m.reply(
      `🏦 *DEPÓSITO EXITOSO*\n\n` +
      `💵 Depositaste: *$${formatNumber(amount)}*\n` +
      `🏦 Saldo en banco: *$${formatNumber(newBankTotal)}*\n` +
      `💰 Efectivo restante: *$${formatNumber(freshUser.money - amount)}*\n\n` +
      `🛡️ *Tu dinero está protegido por 24h*\n` +
      `_Nadie puede robarte lo del banco_`
    );
    await m.react('🏦');
  }
};

/**
 * Plugin: Transferir - Transfiere dinero a otro usuario
 */
export const transferirPlugin: PluginHandler = {
  command: ['transferir', 'transfer', 'enviar', 'pay'],
  tags: ['rpg'],
  help: [
    'transferir @usuario <cantidad> - Transfiere cyalopesos',
    'Comisión aleatoria del 1-15%',
    'No puedes transferir dinero del banco'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const sender = db.getUser(m.sender);

    // Obtener destinatario
    const targetJid = getTargetUser(ctx);

    if (!targetJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres transferir?\n\n` +
        `📝 *Uso:* /transferir @usuario <cantidad>`
      );
      return;
    }

    if (targetJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes transferirte dinero a ti mismo.`);
      return;
    }

    const receiver = db.getUser(targetJid);

    if (!receiver.registered) {
      await m.reply(`${EMOJI.error} Ese usuario no está registrado.`);
      return;
    }

    // Obtener cantidad (puede ser el segundo argumento si el primero es la mención)
    const amountStr = args.find(arg => !arg.startsWith('@') && !isNaN(parseInt(arg)));
    const amount = parseInt(amountStr || '0');

    if (isNaN(amount) || amount <= 0) {
      await m.reply(
        `${EMOJI.error} Cantidad inválida.\n\n` +
        `📝 *Uso:* /transferir @usuario <cantidad>\n` +
        `💡 Ejemplo: /transferir @amigo 1000`
      );
      return;
    }

    if (amount > sender.money) {
      await m.reply(
        `${EMOJI.error} No tienes suficiente dinero en efectivo.\n\n` +
        `💰 Tu efectivo: *$${formatNumber(sender.money)}*\n` +
        `💵 Intentas enviar: *$${formatNumber(amount)}*\n\n` +
        `⚠️ _El dinero del banco no se puede transferir_`
      );
      return;
    }

    // Calcular comisión aleatoria
    const commissionRate = randomInt(TRANSFER_MIN_COMMISSION, TRANSFER_MAX_COMMISSION);
    const commission = Math.floor(amount * commissionRate / 100);
    const finalAmount = amount - commission;

    // Realizar transferencia
    db.updateUser(m.sender, {
      money: sender.money - amount
    });

    db.updateUser(targetJid, {
      money: receiver.money + finalAmount
    });

    const message = pickRandom(TRANSFER_MESSAGES)
      .replace(/{sender}/g, sender.name)
      .replace(/{receiver}/g, receiver.name)
      .replace(/{amount}/g, formatNumber(finalAmount));

    let response = message + '\n\n';
    response += `📊 *DETALLE DE TRANSFERENCIA*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💵 Monto enviado: *$${formatNumber(amount)}*\n`;
    response += `📉 Comisión (${commissionRate}%): *-$${formatNumber(commission)}*\n`;
    response += `✅ Monto recibido: *$${formatNumber(finalAmount)}*\n\n`;
    response += `💰 Tu nuevo saldo: *$${formatNumber(sender.money - amount)}*`;

    await m.reply(response);
    await m.react('💸');
  }
};

/**
 * Plugin: Esclavizar - Esclaviza a otro jugador
 */
export const esclavizarPlugin: PluginHandler = {
  command: ['esclavizar', 'enslave', 'slave'],
  tags: ['rpg'],
  help: [
    'esclavizar @usuario - Esclaviza a otro jugador por 4 horas',
    'Costo: $10,000',
    'Recibirás el 50% de lo que gane tu esclavo',
    'El objetivo no puede estar en modo pasivo'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const master = db.getUser(m.sender);
    const now = Date.now();

    // Verificar si el atacante está en modo pasivo
    if (master.passiveMode && master.passiveModeUntil > now) {
      await m.reply(
        `${EMOJI.error} Estás en *modo pasivo*.\n\n` +
        `🕊️ No puedes esclavizar a nadie mientras estés protegido.\n` +
        `💡 Usa */pasivo* para desactivarlo (cooldown de 6h).`
      );
      return;
    }

    // Verificar si ya tiene esclavos máximos (3)
    const activeSlaves = master.slaves.filter(slaveJid => {
      const slave = db.getUser(slaveJid);
      return slave.slaveUntil > now;
    });

    if (activeSlaves.length >= 3) {
      await m.reply(
        `${EMOJI.error} Ya tienes el máximo de esclavos (3).\n\n` +
        `⛓️ Esclavos actuales: ${activeSlaves.length}/3\n` +
        `⏳ Espera a que expire la esclavitud de alguno.`
      );
      return;
    }

    // Obtener objetivo
    const targetJid = getTargetUser(ctx);

    if (!targetJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres esclavizar?\n\n` +
        `📝 *Uso:* /esclavizar @usuario\n` +
        `💰 Costo: *$${formatNumber(SLAVERY_COST)}*`
      );
      return;
    }

    if (targetJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes esclavizarte a ti mismo... ¿o sí? 🤔`);
      return;
    }

    const target = db.getUser(targetJid);

    if (!target.registered) {
      await m.reply(`${EMOJI.error} Ese jugador no está registrado.`);
      return;
    }

    // Verificar si el objetivo está en modo pasivo
    if (target.passiveMode && target.passiveModeUntil > now) {
      await m.reply(
        `🕊️ *${target.name}* está en *modo pasivo*.\n\n` +
        `No puedes esclavizar a jugadores protegidos.`
      );
      return;
    }

    // Verificar si ya es esclavo de alguien
    if (target.slaveMaster && target.slaveUntil > now) {
      const currentMaster = db.getUser(target.slaveMaster);
      await m.reply(
        `⛓️ *${target.name}* ya es esclavo de *${currentMaster.name}*.\n\n` +
        `⏳ Esclavitud expira en: *${Math.ceil((target.slaveUntil - now) / (60 * 60 * 1000))}h*`
      );
      return;
    }

    // Verificar si tiene dinero para esclavizar
    if (master.money < SLAVERY_COST) {
      await m.reply(
        `${EMOJI.error} No tienes suficiente dinero.\n\n` +
        `💰 Tu dinero: *$${formatNumber(master.money)}*\n` +
        `💵 Costo: *$${formatNumber(SLAVERY_COST)}*`
      );
      return;
    }

    // Realizar la esclavización
    const slaveUntil = now + SLAVERY_DURATION;

    // Actualizar al amo
    db.updateUser(m.sender, {
      money: master.money - SLAVERY_COST,
      slaves: [...master.slaves.filter(s => {
        const slave = db.getUser(s);
        return slave.slaveUntil > now;
      }), targetJid]
    });

    // Actualizar al esclavo
    db.updateUser(targetJid, {
      slaveMaster: m.sender,
      slaveUntil: slaveUntil
    });

    const message = pickRandom(SLAVERY_MESSAGES)
      .replace(/{master}/g, master.name)
      .replace(/{victim}/g, target.name);

    let response = message + '\n\n';
    response += `⛓️ *CONTRATO DE ESCLAVITUD*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `👑 Amo: *${master.name}*\n`;
    response += `🔗 Esclavo: *${target.name}*\n`;
    response += `⏳ Duración: *4 horas*\n`;
    response += `💰 Costo pagado: *$${formatNumber(SLAVERY_COST)}*\n\n`;
    response += `📊 *BENEFICIOS:*\n`;
    response += `• Recibirás el *${SLAVERY_CUT}%* de lo que gane el esclavo\n`;
    response += `• Aplica a: /trabajar, /minar, /daily\n\n`;
    response += `💡 _El esclavo puede liberarse pagando $${formatNumber(SLAVERY_COST * 2)}_`;

    await m.reply(response);
    await m.react('⛓️');
  }
};

/**
 * Plugin: Liberar - Libérate de la esclavitud
 */
export const liberarPlugin: PluginHandler = {
  command: ['liberar', 'free', 'liberarse', 'libertad'],
  tags: ['rpg'],
  help: [
    'liberar - Compra tu libertad (costo: $20,000)',
    'Solo funciona si eres esclavo de alguien'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    // Verificar si es esclavo
    if (!user.slaveMaster || user.slaveUntil <= now) {
      await m.reply(
        `${EMOJI.success} ¡Ya eres libre!\n\n` +
        `🕊️ No tienes ningún amo que te esclavice.`
      );
      return;
    }

    const freedomCost = SLAVERY_COST * 2;

    if (user.money < freedomCost) {
      const master = db.getUser(user.slaveMaster);
      const timeLeft = Math.ceil((user.slaveUntil - now) / (60 * 60 * 1000));

      await m.reply(
        `${EMOJI.error} No tienes suficiente dinero para comprar tu libertad.\n\n` +
        `⛓️ Amo actual: *${master.name}*\n` +
        `💰 Tu dinero: *$${formatNumber(user.money)}*\n` +
        `💵 Costo de libertad: *$${formatNumber(freedomCost)}*\n` +
        `⏳ Esclavitud expira en: *${timeLeft}h*`
      );
      return;
    }

    const master = db.getUser(user.slaveMaster);
    const masterJid = user.slaveMaster;

    // Liberar al esclavo
    db.updateUser(m.sender, {
      money: user.money - freedomCost,
      slaveMaster: null,
      slaveUntil: 0
    });

    // Actualizar lista de esclavos del amo
    db.updateUser(masterJid, {
      slaves: master.slaves.filter(s => s !== m.sender)
    });

    await m.reply(
      `🕊️ *¡LIBERTAD!*\n\n` +
      `Has comprado tu libertad de *${master.name}*.\n\n` +
      `💵 Pagaste: *$${formatNumber(freedomCost)}*\n` +
      `💰 Dinero restante: *$${formatNumber(user.money - freedomCost)}*\n\n` +
      `✨ _Ya no eres esclavo de nadie_`
    );
    await m.react('🕊️');
  }
};

/**
 * Plugin: Ver Esclavos - Lista tus esclavos
 */
export const esclavosPlugin: PluginHandler = {
  command: ['esclavos', 'slaves', 'misesclavos'],
  tags: ['rpg'],
  help: ['esclavos - Ve tu lista de esclavos actuales'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    // Filtrar esclavos activos
    const activeSlaves = user.slaves.filter(slaveJid => {
      const slave = db.getUser(slaveJid);
      return slave.slaveUntil > now && slave.slaveMaster === m.sender;
    });

    if (activeSlaves.length === 0) {
      await m.reply(
        `⛓️ *TUS ESCLAVOS*\n\n` +
        `No tienes esclavos actualmente.\n\n` +
        `💡 Usa */esclavizar @usuario* para conseguir uno.\n` +
        `💰 Costo: *$${formatNumber(SLAVERY_COST)}*`
      );
      return;
    }

    let response = `⛓️ *TUS ESCLAVOS (${activeSlaves.length}/3)*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const slaveJid of activeSlaves) {
      const slave = db.getUser(slaveJid);
      const timeLeft = Math.ceil((slave.slaveUntil - now) / (60 * 60 * 1000));
      response += `🔗 *${slave.name}*\n`;
      response += `   ⏳ Expira en: ${timeLeft}h\n\n`;
    }

    response += `📊 *BENEFICIOS:*\n`;
    response += `• Recibes ${SLAVERY_CUT}% de sus ganancias\n`;
    response += `• Aplica a trabajo, minería y daily`;

    await m.reply(response);
  }
};

/**
 * Plugin: Modo Pasivo - Activa/desactiva modo pacífico
 */
export const pasivoPlugin: PluginHandler = {
  command: ['pasivo', 'passive', 'pacifico', 'paz'],
  tags: ['rpg'],
  help: [
    'pasivo - Activa/desactiva el modo pasivo',
    'En modo pasivo no puedes robar ni ser robado',
    'Tampoco puedes bombardear ni ser bombardeado',
    'Cooldown de 6 horas para cambiar de modo'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    // Verificar cooldown
    if (user.passiveModeChangedAt > 0) {
      const timeSinceChange = now - user.passiveModeChangedAt;
      if (timeSinceChange < PASSIVE_MODE_COOLDOWN) {
        const remaining = PASSIVE_MODE_COOLDOWN - timeSinceChange;
        const hoursLeft = Math.ceil(remaining / (60 * 60 * 1000));
        const minsLeft = Math.ceil((remaining % (60 * 60 * 1000)) / (60 * 1000));

        await m.reply(
          `${EMOJI.time} *COOLDOWN ACTIVO*\n\n` +
          `🕊️ Estado actual: *${user.passiveMode ? 'Pasivo' : 'Activo'}*\n` +
          `⏳ Puedes cambiar en: *${hoursLeft}h ${minsLeft}m*\n\n` +
          `💡 _El cooldown evita el abuso del modo pasivo_`
        );
        return;
      }
    }

    // Verificar si es esclavo
    if (user.slaveMaster && user.slaveUntil > now) {
      await m.reply(
        `${EMOJI.error} No puedes cambiar el modo pasivo siendo esclavo.\n\n` +
        `⛓️ Primero debes comprar tu libertad con */liberar*`
      );
      return;
    }

    // Cambiar modo
    const newMode = !user.passiveMode;
    const modeUntil = newMode ? now + (30 * 24 * 60 * 60 * 1000) : 0; // 30 días si activo

    db.updateUser(m.sender, {
      passiveMode: newMode,
      passiveModeUntil: modeUntil,
      passiveModeChangedAt: now
    });

    if (newMode) {
      await m.reply(
        `🕊️ *MODO PASIVO ACTIVADO*\n\n` +
        `✅ Ya no puedes:\n` +
        `• Robar a otros jugadores\n` +
        `• Ser robado por otros\n` +
        `• Bombardear a otros\n` +
        `• Ser bombardeado\n` +
        `• Esclavizar a otros\n` +
        `• Ser esclavizado\n\n` +
        `⏳ Cooldown para desactivar: *6 horas*\n` +
        `_Modo pacífico perfecto para farmear tranquilo_`
      );
      await m.react('🕊️');
    } else {
      await m.reply(
        `⚔️ *MODO PASIVO DESACTIVADO*\n\n` +
        `✅ Ahora puedes:\n` +
        `• Robar a otros jugadores\n` +
        `• Bombardear a otros\n` +
        `• Esclavizar a otros\n\n` +
        `⚠️ También pueden:\n` +
        `• Robarte\n` +
        `• Bombardearte\n` +
        `• Esclavizarte\n\n` +
        `⏳ Cooldown para reactivar: *6 horas*\n` +
        `_¡Prepárate para la acción!_`
      );
      await m.react('⚔️');
    }
  }
};

/**
 * Plugin: Ver Estado - Muestra tu estado económico completo
 */
export const estadoEconomiaPlugin: PluginHandler = {
  command: ['economia', 'economy', 'mieconomia', 'wallet'],
  tags: ['rpg'],
  help: ['economia - Ve tu estado económico completo'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    let response = `💰 *ESTADO ECONÓMICO*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `👤 *${user.name}*\n\n`;

    // Dinero
    response += `💵 *FINANZAS:*\n`;
    response += `• Efectivo: *$${formatNumber(user.money)}*\n`;
    response += `• Banco: *$${formatNumber(user.bank)}*\n`;
    response += `• Diamantes: *💎${formatNumber(user.limit)}*\n`;

    if (user.debt > 0) {
      response += `• ⚠️ Deuda IMSS: *$${formatNumber(user.debt)}*\n`;
    }

    response += `\n`;

    // Modo pasivo
    response += `🛡️ *ESTADO:*\n`;
    if (user.passiveMode && user.passiveModeUntil > now) {
      response += `• Modo: *🕊️ Pasivo*\n`;
    } else {
      response += `• Modo: *⚔️ Activo*\n`;
    }

    // Esclavitud
    if (user.slaveMaster && user.slaveUntil > now) {
      const master = db.getUser(user.slaveMaster);
      const timeLeft = Math.ceil((user.slaveUntil - now) / (60 * 60 * 1000));
      response += `• ⛓️ Esclavo de: *${master.name}*\n`;
      response += `• ⏳ Expira en: *${timeLeft}h*\n`;
    }

    // Esclavos
    const activeSlaves = user.slaves.filter(slaveJid => {
      const slave = db.getUser(slaveJid);
      return slave.slaveUntil > now && slave.slaveMaster === m.sender;
    });

    if (activeSlaves.length > 0) {
      response += `• 👑 Esclavos: *${activeSlaves.length}/3*\n`;
    }

    // Protecciones
    response += `\n🛡️ *PROTECCIONES:*\n`;

    if (user.bankDepositTime > 0) {
      const bankExpired = now > user.bankDepositTime + BANK_DURATION;
      if (!bankExpired && user.bank > 0) {
        const timeLeft = Math.ceil((user.bankDepositTime + BANK_DURATION - now) / (60 * 60 * 1000));
        response += `• 🏦 Banco protegido: *${timeLeft}h*\n`;
      }
    }

    if (user.shieldRobo > now) {
      const timeLeft = Math.ceil((user.shieldRobo - now) / (60 * 60 * 1000));
      response += `• 🛡️ Anti-robo: *${timeLeft}h*\n`;
    }

    if (user.shieldBombas > now) {
      const timeLeft = Math.ceil((user.shieldBombas - now) / (60 * 60 * 1000));
      response += `• 🧱 Anti-bombas: *${timeLeft}h*\n`;
    }

    if (user.seguroVida > now) {
      const timeLeft = Math.ceil((user.seguroVida - now) / (60 * 60 * 1000));
      response += `• 📜 Seguro de vida: *${timeLeft}h*\n`;
    }

    await m.reply(response);
  }
};

export default bancoPlugin;
