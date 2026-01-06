/**
 * ⚔️ Plugin de Duelos PvP - RPG
 * Comando: duelo - Desafía a otro jugador a un combate
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { ITEMS, CLASSES, SKILLS, type Skill } from '../types/rpg.js';
import { calculateTotalStats, type UserRPG } from '../types/user.js';

/**
 * Cooldown de duelo: 30 minutos
 */
const DUEL_COOLDOWN = 30 * 60 * 1000;

/**
 * Pendientes de duelo: Map<retador_jid, { target: string, timestamp: number }>
 */
const pendingDuels = new Map<string, { target: string; timestamp: number; bet: number }>();

/**
 * Mensajes de victoria en duelo
 */
const VICTORY_MESSAGES = [
  '🏆 *{winner}* derrotó a *{loser}* en un combate épico!',
  '⚔️ *{winner}* demostró su superioridad sobre *{loser}*!',
  '💀 *{loser}* cayó ante el poder de *{winner}*!',
  '🎖️ *{winner}* se alzó victorioso contra *{loser}*!',
  '👑 *{winner}* es el campeón! *{loser}* necesita entrenar más.'
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
 * Calcula el daño en duelo
 */
function calculateDuelDamage(
  attacker: { attack: number; critChance: number; playerClass: string | null },
  defender: { defense: number },
  skill?: Skill
): { damage: number; isCrit: boolean; skillUsed?: string } {
  let baseDamage = attacker.attack;
  let skillUsed: string | undefined;

  // Aplicar multiplicador de habilidad si se usa
  if (skill) {
    baseDamage = Math.floor(baseDamage * (skill.effect.damageMultiplier || 1));
    skillUsed = skill.name;
  }

  // Calcular daño final
  const reduction = defender.defense * 0.4;
  let damage = Math.max(1, Math.floor(baseDamage - reduction));

  // Varianza
  const variance = randomInt(-15, 15) / 100;
  damage = Math.floor(damage * (1 + variance));

  // Crítico
  const isCrit = randomInt(1, 100) <= attacker.critChance;
  if (isCrit) {
    damage = Math.floor(damage * 1.75);
  }

  return { damage: Math.max(1, damage), isCrit, skillUsed };
}

/**
 * Simula un turno de duelo
 */
function simulateDuelTurn(
  attackerStats: { attack: number; defense: number; critChance: number; mana: number; stamina: number; playerClass: string | null },
  defenderStats: { defense: number },
  attackerClass: string | null
): { damage: number; isCrit: boolean; skillUsed?: string; manaCost: number; staminaCost: number } {
  let skill: Skill | undefined;
  let manaCost = 0;
  let staminaCost = 5;

  // 30% de chance de usar una habilidad si tiene clase y recursos
  if (attackerClass && Math.random() < 0.3) {
    const classInfo = CLASSES[attackerClass as keyof typeof CLASSES];
    if (classInfo) {
      const availableSkills = classInfo.skills
        .map(id => SKILLS[id])
        .filter(s => s && attackerStats.mana >= s.manaCost && attackerStats.stamina >= s.staminaCost);

      if (availableSkills.length > 0) {
        skill = pickRandom(availableSkills);
        manaCost = skill.manaCost;
        staminaCost = skill.staminaCost;
      }
    }
  }

  const result = calculateDuelDamage(
    { attack: attackerStats.attack, critChance: attackerStats.critChance, playerClass: attackerClass },
    defenderStats,
    skill
  );

  return {
    ...result,
    manaCost,
    staminaCost
  };
}

/**
 * Simula el duelo completo
 */
function simulateDuel(
  player1: { name: string; stats: ReturnType<typeof calculateTotalStats>; health: number; mana: number; stamina: number; class: string | null },
  player2: { name: string; stats: ReturnType<typeof calculateTotalStats>; health: number; mana: number; stamina: number; class: string | null }
): {
  winner: 1 | 2;
  log: string[];
  p1FinalHealth: number;
  p2FinalHealth: number;
  p1DamageDealt: number;
  p2DamageDealt: number;
} {
  let p1Health = player1.health;
  let p2Health = player2.health;
  let p1Mana = player1.mana;
  let p2Mana = player2.mana;
  let p1Stamina = player1.stamina;
  let p2Stamina = player2.stamina;
  let p1TotalDamage = 0;
  let p2TotalDamage = 0;

  const log: string[] = [];
  let turn = 0;
  let currentAttacker = Math.random() < 0.5 ? 1 : 2; // Quien empieza es aleatorio

  log.push(`🎲 *${currentAttacker === 1 ? player1.name : player2.name}* tiene la iniciativa!\n`);

  while (p1Health > 0 && p2Health > 0 && turn < 15) {
    turn++;

    if (currentAttacker === 1) {
      const result = simulateDuelTurn(
        { ...player1.stats, mana: p1Mana, stamina: p1Stamina, playerClass: player1.class },
        { defense: player2.stats.defense },
        player1.class
      );

      p2Health -= result.damage;
      p1Mana -= result.manaCost;
      p1Stamina -= result.staminaCost;
      p1TotalDamage += result.damage;

      let turnLog = `⚔️ *${player1.name}*`;
      if (result.skillUsed) {
        turnLog += ` usa *${result.skillUsed}*`;
      }
      if (result.isCrit) {
        turnLog += ` 💥CRÍTICO!`;
      }
      turnLog += ` → ${result.damage} daño`;
      log.push(turnLog);

    } else {
      const result = simulateDuelTurn(
        { ...player2.stats, mana: p2Mana, stamina: p2Stamina, playerClass: player2.class },
        { defense: player1.stats.defense },
        player2.class
      );

      p1Health -= result.damage;
      p2Mana -= result.manaCost;
      p2Stamina -= result.staminaCost;
      p2TotalDamage += result.damage;

      let turnLog = `⚔️ *${player2.name}*`;
      if (result.skillUsed) {
        turnLog += ` usa *${result.skillUsed}*`;
      }
      if (result.isCrit) {
        turnLog += ` 💥CRÍTICO!`;
      }
      turnLog += ` → ${result.damage} daño`;
      log.push(turnLog);
    }

    currentAttacker = currentAttacker === 1 ? 2 : 1;
  }

  const winner = p1Health > p2Health ? 1 : 2;

  return {
    winner,
    log: log.slice(-8),
    p1FinalHealth: Math.max(0, p1Health),
    p2FinalHealth: Math.max(0, p2Health),
    p1DamageDealt: p1TotalDamage,
    p2DamageDealt: p2TotalDamage
  };
}

/**
 * Plugin: Duelo - Desafiar a otro jugador
 */
export const dueloPlugin: PluginHandler = {
  command: ['duelo', 'duel', 'pvp', 'pelea', 'retar'],
  tags: ['rpg'],
  help: [
    'duelo @usuario [apuesta] - Desafía a un jugador',
    'El retado debe aceptar con /aceptar',
    'El ganador obtiene XP, fama y la apuesta',
    'Cooldown: 30 minutos'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const challenger = db.getUser(m.sender);

    // Verificar cooldown
    const now = Date.now();
    const lastDuel = challenger.lastduel || 0;

    if (now - lastDuel < DUEL_COOLDOWN) {
      const remaining = DUEL_COOLDOWN - (now - lastDuel);
      await m.reply(
        `${EMOJI.time} ¡Acabas de pelear!\n\n` +
        `⏳ Espera *${msToTime(remaining)}* para volver a retar.`
      );
      return;
    }

    // Verificar salud
    if (challenger.health < 30) {
      await m.reply(
        `${EMOJI.error} ¡Estás muy herido para un duelo!\n\n` +
        `❤️ Salud: *${challenger.health}/${challenger.maxHealth}*\n` +
        `💡 Usa una poción para curarte.`
      );
      return;
    }

    // Obtener objetivo
    const targetJid = getTargetUser(ctx);

    if (!targetJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres retar?\n\n` +
        `📝 *Uso:* /duelo @usuario [apuesta]\n` +
        `💰 La apuesta es opcional (mín. 100, máx. 10000)`
      );
      return;
    }

    if (targetJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes retarte a ti mismo...`);
      return;
    }

    const target = db.getUser(targetJid);

    if (!target.registered) {
      await m.reply(`${EMOJI.error} Ese jugador no está registrado en el RPG.`);
      return;
    }

    if (target.health < 30) {
      await m.reply(`${EMOJI.warning} *${target.name}* está muy herido para un duelo.`);
      return;
    }

    // Parsear apuesta
    let bet = 0;
    const betArg = args.find(a => /^\d+$/.test(a));
    if (betArg) {
      bet = Math.min(10000, Math.max(100, parseInt(betArg)));

      if (challenger.money < bet) {
        await m.reply(`${EMOJI.error} No tienes suficiente dinero para esa apuesta.`);
        return;
      }
      if (target.money < bet) {
        await m.reply(`${EMOJI.error} *${target.name}* no tiene suficiente dinero para esa apuesta.`);
        return;
      }
    }

    // Registrar desafío pendiente
    pendingDuels.set(m.sender, {
      target: targetJid,
      timestamp: now,
      bet
    });

    // Limpiar desafíos antiguos (más de 2 minutos)
    setTimeout(() => {
      const pending = pendingDuels.get(m.sender);
      if (pending && now === pending.timestamp) {
        pendingDuels.delete(m.sender);
      }
    }, 2 * 60 * 1000);

    const targetName = targetJid.split('@')[0];
    let challengeMsg = `⚔️ *¡DESAFÍO DE DUELO!*\n`;
    challengeMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    challengeMsg += `🗡️ *${challenger.name}* (Nv.${challenger.level})\n`;
    challengeMsg += `   vs\n`;
    challengeMsg += `🛡️ *${target.name}* (Nv.${target.level})\n\n`;

    if (bet > 0) {
      challengeMsg += `💰 *Apuesta:* ${formatNumber(bet)} monedas\n\n`;
    }

    challengeMsg += `@${targetName}, escribe */aceptar* para pelear\n`;
    challengeMsg += `o */rechazar* para declinar.\n\n`;
    challengeMsg += `⏰ _El desafío expira en 2 minutos._`;

    await m.reply(challengeMsg);
    await m.react('⚔️');
  }
};

/**
 * Plugin: Aceptar - Acepta un duelo
 */
export const aceptarPlugin: PluginHandler = {
  command: ['aceptar', 'accept', 'si'],
  tags: ['rpg'],
  help: ['aceptar - Acepta un desafío de duelo pendiente'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const accepter = db.getUser(m.sender);

    // Buscar desafío pendiente para este jugador
    let challengerJid: string | null = null;
    let duelInfo: { target: string; timestamp: number; bet: number } | null = null;

    for (const [cJid, info] of pendingDuels.entries()) {
      if (info.target === m.sender && Date.now() - info.timestamp < 2 * 60 * 1000) {
        challengerJid = cJid;
        duelInfo = info;
        break;
      }
    }

    if (!challengerJid || !duelInfo) {
      await m.reply(`${EMOJI.error} No tienes ningún desafío de duelo pendiente.`);
      return;
    }

    const challenger = db.getUser(challengerJid);

    // Verificar que ambos tengan salud suficiente
    if (accepter.health < 30) {
      await m.reply(`${EMOJI.error} Estás muy herido para pelear. Cúrate primero.`);
      return;
    }

    if (challenger.health < 30) {
      await m.reply(`${EMOJI.error} *${challenger.name}* ya no puede pelear.`);
      pendingDuels.delete(challengerJid);
      return;
    }

    // Verificar apuesta
    if (duelInfo.bet > 0) {
      if (accepter.money < duelInfo.bet || challenger.money < duelInfo.bet) {
        await m.reply(`${EMOJI.error} Uno de los jugadores ya no tiene suficiente dinero para la apuesta.`);
        pendingDuels.delete(challengerJid);
        return;
      }
    }

    // Eliminar desafío pendiente
    pendingDuels.delete(challengerJid);

    await m.react('⚔️');

    // Calcular stats
    const challengerStats = calculateTotalStats(challenger, ITEMS);
    const accepterStats = calculateTotalStats(accepter, ITEMS);

    // Simular duelo
    const result = simulateDuel(
      {
        name: challenger.name,
        stats: challengerStats,
        health: challenger.health,
        mana: challenger.mana,
        stamina: challenger.stamina,
        class: challenger.playerClass
      },
      {
        name: accepter.name,
        stats: accepterStats,
        health: accepter.health,
        mana: accepter.mana,
        stamina: accepter.stamina,
        class: accepter.playerClass
      }
    );

    const now = Date.now();
    const winnerJid = result.winner === 1 ? challengerJid : m.sender;
    const loserJid = result.winner === 1 ? m.sender : challengerJid;
    const winner = result.winner === 1 ? challenger : accepter;
    const loser = result.winner === 1 ? accepter : challenger;

    // Calcular recompensas
    const baseExpReward = 200 + Math.floor(loser.level * 10);
    const expReward = baseExpReward + randomInt(0, 100);

    // Actualizar cooldowns
    db.updateUser(challengerJid, { lastduel: now });
    db.updateUser(m.sender, { lastduel: now });

    // Actualizar stats del ganador
    const winnerStats = { ...db.getUser(winnerJid).combatStats };
    winnerStats.pvpWins++;
    winnerStats.totalDamageDealt += result.winner === 1 ? result.p1DamageDealt : result.p2DamageDealt;

    db.updateUser(winnerJid, {
      health: result.winner === 1 ? Math.max(10, result.p1FinalHealth) : Math.max(10, result.p2FinalHealth),
      exp: winner.exp + expReward,
      money: winner.money + duelInfo.bet,
      combatStats: winnerStats
    });

    // Actualizar stats del perdedor
    const loserStats = { ...db.getUser(loserJid).combatStats };
    loserStats.pvpLosses++;
    loserStats.totalDamageDealt += result.winner === 1 ? result.p2DamageDealt : result.p1DamageDealt;

    db.updateUser(loserJid, {
      health: result.winner === 1 ? Math.max(5, result.p2FinalHealth) : Math.max(5, result.p1FinalHealth),
      money: Math.max(0, loser.money - duelInfo.bet),
      combatStats: loserStats
    });

    // Construir mensaje de resultado
    let resultMsg = `⚔️ *¡DUELO FINALIZADO!*\n`;
    resultMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    resultMsg += `📜 *Registro de combate:*\n`;
    for (const line of result.log) {
      resultMsg += `${line}\n`;
    }

    resultMsg += `\n${pickRandom(VICTORY_MESSAGES)
      .replace('{winner}', winner.name)
      .replace('{loser}', loser.name)}\n\n`;

    resultMsg += `🏆 *${winner.name}* gana:\n`;
    resultMsg += `   ${EMOJI.exp} +${formatNumber(expReward)} XP\n`;
    if (duelInfo.bet > 0) {
      resultMsg += `   ${EMOJI.coin} +${formatNumber(duelInfo.bet)} monedas\n`;
    }

    resultMsg += `\n❤️ Salud final:\n`;
    resultMsg += `   ${challenger.name}: *${result.p1FinalHealth}* HP\n`;
    resultMsg += `   ${accepter.name}: *${result.p2FinalHealth}* HP`;

    await m.reply(resultMsg);
    await m.react('🏆');
  }
};

/**
 * Plugin: Rechazar - Rechaza un duelo
 */
export const rechazarPlugin: PluginHandler = {
  command: ['rechazar', 'decline', 'no', 'negar'],
  tags: ['rpg'],
  help: ['rechazar - Rechaza un desafío de duelo pendiente'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Buscar desafío pendiente
    let challengerJid: string | null = null;

    for (const [cJid, info] of pendingDuels.entries()) {
      if (info.target === m.sender) {
        challengerJid = cJid;
        break;
      }
    }

    if (!challengerJid) {
      await m.reply(`${EMOJI.info} No tienes ningún desafío pendiente.`);
      return;
    }

    const challenger = db.getUser(challengerJid);
    pendingDuels.delete(challengerJid);

    await m.reply(
      `${EMOJI.error} *${user.name}* ha rechazado el duelo de *${challenger.name}*.\n\n` +
      `💔 _Quizás otro día..._`
    );
    await m.react('❌');
  }
};

export default dueloPlugin;
