/**
 * ⚔️ Plugin de Duelos PvP Interactivo - RPG
 * Comando: duelo - Desafía a otro jugador a un combate interactivo por turnos
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom, matchesIgnoreAccents } from '../lib/utils.js';
import { ITEMS, CLASSES, SKILLS, type Skill } from '../types/rpg.js';
import { calculateTotalStats, type UserRPG } from '../types/user.js';

/**
 * Estructura de un duelo activo
 */
interface ActiveDuel {
  challengerJid: string;
  targetJid: string;
  challengerName: string;
  targetName: string;
  challengerHealth: number;
  targetHealth: number;
  challengerMaxHealth: number;
  targetMaxHealth: number;
  challengerMana: number;
  targetMana: number;
  challengerStamina: number;
  targetStamina: number;
  challengerStats: ReturnType<typeof calculateTotalStats>;
  targetStats: ReturnType<typeof calculateTotalStats>;
  challengerClass: string | null;
  targetClass: string | null;
  currentTurn: 'challenger' | 'target';
  bet: number;
  turnStartTime: number;
  groupJid: string;
  log: string[];
}

/**
 * Pendientes de duelo: Map<retador_jid, { target: string, timestamp: number }>
 */
const pendingDuels = new Map<string, { target: string; timestamp: number; bet: number }>();

/**
 * Duelos activos: Map<groupJid, ActiveDuel>
 */
const activeDuels = new Map<string, ActiveDuel>();

/**
 * Tiempo máximo por turno: 30 segundos
 */
const TURN_TIMEOUT = 30 * 1000;

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
 * Calcula el daño de un ataque en duelo interactivo
 */
function calculateInteractiveDamage(
  attackerStats: { attack: number; critChance: number },
  defenderStats: { defense: number },
  skill?: Skill,
  isFirstAttack: boolean = false
): { damage: number; isCrit: boolean; skillUsed?: string } {
  let baseDamage = attackerStats.attack;
  let skillUsed: string | undefined;

  // Aplicar multiplicador de habilidad si se usa
  if (skill) {
    baseDamage = Math.floor(baseDamage * (skill.effect.damageMultiplier || 1));
    skillUsed = skill.name;
  }

  // Bonus por atacar primero (15% más daño)
  if (isFirstAttack) {
    baseDamage = Math.floor(baseDamage * 1.15);
  }

  // Calcular daño final
  const reduction = defenderStats.defense * 0.4;
  let damage = Math.max(1, Math.floor(baseDamage - reduction));

  // Varianza
  const variance = randomInt(-10, 10) / 100;
  damage = Math.floor(damage * (1 + variance));

  // Crítico
  const isCrit = randomInt(1, 100) <= attackerStats.critChance;
  if (isCrit) {
    damage = Math.floor(damage * 1.75);
  }

  return { damage: Math.max(1, damage), isCrit, skillUsed };
}

/**
 * Obtiene las habilidades disponibles para un jugador
 */
function getAvailableSkills(playerClass: string | null, mana: number, stamina: number): Skill[] {
  if (!playerClass) return [];

  const classInfo = CLASSES[playerClass as keyof typeof CLASSES];
  if (!classInfo) return [];

  return classInfo.skills
    .map(id => SKILLS[id])
    .filter(s => s && mana >= s.manaCost && stamina >= s.staminaCost);
}

/**
 * Genera el mensaje del estado del duelo
 */
function generateDuelStatusMessage(duel: ActiveDuel): string {
  const currentPlayer = duel.currentTurn === 'challenger' ? duel.challengerName : duel.targetName;
  const currentJid = duel.currentTurn === 'challenger' ? duel.challengerJid : duel.targetJid;

  let msg = `⚔️ *DUELO EN CURSO*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Estado de los jugadores
  msg += `🗡️ *${duel.challengerName}*\n`;
  msg += `   ❤️ ${duel.challengerHealth}/${duel.challengerMaxHealth}\n`;
  msg += `   💙 ${duel.challengerMana} | ⚡ ${duel.challengerStamina}\n\n`;

  msg += `🛡️ *${duel.targetName}*\n`;
  msg += `   ❤️ ${duel.targetHealth}/${duel.targetMaxHealth}\n`;
  msg += `   💙 ${duel.targetMana} | ⚡ ${duel.targetStamina}\n\n`;

  // Log de combate (últimos 3)
  if (duel.log.length > 0) {
    msg += `📜 *Últimas acciones:*\n`;
    for (const line of duel.log.slice(-3)) {
      msg += `   ${line}\n`;
    }
    msg += '\n';
  }

  // Turno actual
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🎯 *Turno de: ${currentPlayer}*\n\n`;
  msg += `*Comandos disponibles:*\n`;
  msg += `• */atacar* - Ataque básico\n`;

  // Mostrar habilidades disponibles
  const currentMana = duel.currentTurn === 'challenger' ? duel.challengerMana : duel.targetMana;
  const currentStamina = duel.currentTurn === 'challenger' ? duel.challengerStamina : duel.targetStamina;
  const currentClass = duel.currentTurn === 'challenger' ? duel.challengerClass : duel.targetClass;

  const availableSkills = getAvailableSkills(currentClass, currentMana, currentStamina);
  if (availableSkills.length > 0) {
    msg += `• */habilidad [nombre]* - Usar habilidad\n`;
    msg += `  Disponibles: ${availableSkills.map(s => `${s.emoji}${s.name}`).join(', ')}\n`;
  }

  msg += `• */rendirse* - Abandonar el duelo\n\n`;
  msg += `⏰ _Tienes 30 segundos para actuar_`;

  return msg;
}

/**
 * Finaliza un duelo y reparte recompensas
 */
async function finishDuel(duel: ActiveDuel, winnerJid: string, ctx: MessageContext, reason: 'victory' | 'surrender' | 'timeout'): Promise<void> {
  const db = getDatabase();
  const loserJid = winnerJid === duel.challengerJid ? duel.targetJid : duel.challengerJid;

  const winner = db.getUser(winnerJid);
  const loser = db.getUser(loserJid);

  const winnerName = winnerJid === duel.challengerJid ? duel.challengerName : duel.targetName;
  const loserName = winnerJid === duel.challengerJid ? duel.targetName : duel.challengerName;

  // Calcular recompensas
  const baseExpReward = 300 + Math.floor(loser.level * 15);
  const expReward = baseExpReward + randomInt(0, 150);

  // Actualizar stats del ganador
  const winnerStats = { ...winner.combatStats };
  winnerStats.pvpWins++;

  db.updateUser(winnerJid, {
    exp: winner.exp + expReward,
    money: winner.money + duel.bet,
    combatStats: winnerStats
  });

  // Actualizar stats del perdedor
  const loserStats = { ...loser.combatStats };
  loserStats.pvpLosses++;

  db.updateUser(loserJid, {
    money: Math.max(0, loser.money - duel.bet),
    combatStats: loserStats
  });

  // Eliminar duelo activo
  activeDuels.delete(duel.groupJid);

  // Mensaje de fin
  let reasonText = '';
  switch (reason) {
    case 'victory':
      reasonText = pickRandom(VICTORY_MESSAGES)
        .replace('{winner}', winnerName)
        .replace('{loser}', loserName);
      break;
    case 'surrender':
      reasonText = `🏳️ *${loserName}* se rindió ante *${winnerName}*!`;
      break;
    case 'timeout':
      reasonText = `⏰ *${loserName}* no respondió a tiempo. *${winnerName}* gana!`;
      break;
  }

  let resultMsg = `⚔️ *¡DUELO FINALIZADO!*\n`;
  resultMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  resultMsg += `${reasonText}\n\n`;

  // Log final
  if (duel.log.length > 0) {
    resultMsg += `📜 *Registro de combate:*\n`;
    for (const line of duel.log.slice(-6)) {
      resultMsg += `   ${line}\n`;
    }
    resultMsg += '\n';
  }

  resultMsg += `🏆 *${winnerName}* gana:\n`;
  resultMsg += `   ${EMOJI.exp} +${formatNumber(expReward)} XP\n`;
  if (duel.bet > 0) {
    resultMsg += `   ${EMOJI.coin} +${formatNumber(duel.bet)} monedas\n`;
  }

  resultMsg += `\n❤️ Salud final:\n`;
  resultMsg += `   ${duel.challengerName}: *${duel.challengerHealth}* HP\n`;
  resultMsg += `   ${duel.targetName}: *${duel.targetHealth}* HP`;

  await ctx.m.reply(resultMsg);
}

/**
 * Plugin: Duelo - Desafiar a otro jugador
 */
export const dueloPlugin: PluginHandler = {
  command: ['duelo', 'duel', 'pvp', 'retar'],
  tags: ['rpg'],
  help: [
    'duelo @usuario [apuesta] - Desafía a un jugador',
    'El retado debe aceptar con /aceptar',
    'El ganador obtiene XP, fama y la apuesta',
    '¡Sin cooldown! Pelea cuando quieras'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const challenger = db.getUser(m.sender);
    const groupJid = m.chat;

    // Verificar si ya hay un duelo activo en el grupo
    if (activeDuels.has(groupJid)) {
      await m.reply(
        `${EMOJI.error} Ya hay un duelo en curso en este grupo.\n` +
        `Espera a que termine para iniciar otro.`
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
        `💰 La apuesta es opcional (mín. 100, máx. 50000)`
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

    // Parsear apuesta (límite aumentado)
    let bet = 0;
    const betArg = args.find(a => /^\d+$/.test(a));
    if (betArg) {
      bet = Math.min(50000, Math.max(100, parseInt(betArg)));

      if (challenger.money < bet) {
        await m.reply(`${EMOJI.error} No tienes suficiente dinero para esa apuesta.`);
        return;
      }
      if (target.money < bet) {
        await m.reply(`${EMOJI.error} *${target.name}* no tiene suficiente dinero para esa apuesta.`);
        return;
      }
    }

    const now = Date.now();

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
    let challengeMsg = `⚔️ *¡DESAFÍO DE DUELO INTERACTIVO!*\n`;
    challengeMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    challengeMsg += `🗡️ *${challenger.name}* (Nv.${challenger.level})\n`;
    challengeMsg += `   ❤️ ${challenger.health}/${challenger.maxHealth} | 💙 ${challenger.mana} | ⚡ ${challenger.stamina}\n`;
    if (challenger.playerClass) {
      challengeMsg += `   Clase: ${CLASSES[challenger.playerClass as keyof typeof CLASSES]?.emoji} ${CLASSES[challenger.playerClass as keyof typeof CLASSES]?.name}\n`;
    }
    challengeMsg += `\n   vs\n\n`;
    challengeMsg += `🛡️ *${target.name}* (Nv.${target.level})\n`;
    challengeMsg += `   ❤️ ${target.health}/${target.maxHealth} | 💙 ${target.mana} | ⚡ ${target.stamina}\n`;
    if (target.playerClass) {
      challengeMsg += `   Clase: ${CLASSES[target.playerClass as keyof typeof CLASSES]?.emoji} ${CLASSES[target.playerClass as keyof typeof CLASSES]?.name}\n`;
    }

    challengeMsg += '\n';
    if (bet > 0) {
      challengeMsg += `💰 *Apuesta:* ${formatNumber(bet)} monedas\n\n`;
    }

    challengeMsg += `🎮 *¡Duelo Interactivo!*\n`;
    challengeMsg += `   • Cada jugador ataca en su turno\n`;
    challengeMsg += `   • Usa tus habilidades y poderes\n`;
    challengeMsg += `   • ¡El primero en escribir tiene ventaja!\n\n`;

    challengeMsg += `@${targetName}, escribe */aceptar* para pelear\n`;
    challengeMsg += `o */rechazar* para declinar.\n\n`;
    challengeMsg += `⏰ _El desafío expira en 2 minutos._`;

    await m.reply(challengeMsg);
    await m.react('⚔️');
  }
};

/**
 * Plugin: Aceptar - Acepta un duelo e inicia el combate interactivo
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
    const groupJid = m.chat;

    // Verificar si ya hay un duelo activo
    if (activeDuels.has(groupJid)) {
      await m.reply(`${EMOJI.error} Ya hay un duelo en curso en este grupo.`);
      return;
    }

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

    // Crear duelo activo
    const newDuel: ActiveDuel = {
      challengerJid,
      targetJid: m.sender,
      challengerName: challenger.name,
      targetName: accepter.name,
      challengerHealth: challenger.health,
      targetHealth: accepter.health,
      challengerMaxHealth: challenger.maxHealth,
      targetMaxHealth: accepter.maxHealth,
      challengerMana: challenger.mana,
      targetMana: accepter.mana,
      challengerStamina: challenger.stamina,
      targetStamina: accepter.stamina,
      challengerStats,
      targetStats: accepterStats,
      challengerClass: challenger.playerClass,
      targetClass: accepter.playerClass,
      currentTurn: 'challenger', // El retador empieza
      bet: duelInfo.bet,
      turnStartTime: Date.now(),
      groupJid,
      log: []
    };

    activeDuels.set(groupJid, newDuel);

    // Mensaje de inicio del duelo
    let startMsg = `⚔️ *¡DUELO INICIADO!*\n`;
    startMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    startMsg += `🗡️ *${challenger.name}* VS 🛡️ *${accepter.name}*\n\n`;
    startMsg += `¡El combate interactivo ha comenzado!\n`;
    startMsg += `Cada jugador atacará en su turno.\n`;
    startMsg += `¡El primero en atacar tiene ventaja de daño!\n\n`;

    await m.reply(startMsg);

    // Enviar estado del duelo
    const statusMsg = generateDuelStatusMessage(newDuel);
    await m.reply(statusMsg);

    // Configurar timeout para el turno
    setTimeout(async () => {
      const duel = activeDuels.get(groupJid);
      if (duel && duel.turnStartTime === newDuel.turnStartTime) {
        // El jugador no respondió a tiempo
        const loserJid = duel.currentTurn === 'challenger' ? duel.challengerJid : duel.targetJid;
        const winnerJid = duel.currentTurn === 'challenger' ? duel.targetJid : duel.challengerJid;
        await finishDuel(duel, winnerJid, ctx, 'timeout');
      }
    }, TURN_TIMEOUT);
  }
};

/**
 * Plugin: Atacar en duelo - Ataque básico durante un duelo
 */
export const atacarDueloPlugin: PluginHandler = {
  command: ['atacar', 'attack', 'golpear'],
  tags: ['rpg'],
  help: ['atacar - Realiza un ataque básico en un duelo activo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupJid = m.chat;

    // Verificar si hay un duelo activo
    const duel = activeDuels.get(groupJid);
    if (!duel) {
      // Si no hay duelo, puede ser el comando de cazar monstruos
      // Lo dejamos pasar para el otro plugin
      return;
    }

    // Verificar si es el turno del jugador
    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) {
      await m.reply(`${EMOJI.error} No estás participando en este duelo.`);
      return;
    }

    const expectedTurn = duel.currentTurn === 'challenger' ? duel.challengerJid : duel.targetJid;
    const isFirstAttack = duel.log.length === 0;

    // Bonus de velocidad: el primero en escribir ataca con ventaja
    if (m.sender !== expectedTurn && isFirstAttack) {
      // El otro jugador fue más rápido, cambiamos el turno
      duel.currentTurn = isChallenger ? 'challenger' : 'target';
      duel.log.push(`⚡ *${isChallenger ? duel.challengerName : duel.targetName}* fue más rápido!`);
    } else if (m.sender !== expectedTurn) {
      await m.reply(`${EMOJI.error} No es tu turno. Espera a que tu oponente ataque.`);
      return;
    }

    // Ejecutar ataque
    const attackerStats = isChallenger ? duel.challengerStats : duel.targetStats;
    const defenderStats = isChallenger ? duel.targetStats : duel.challengerStats;
    const attackerName = isChallenger ? duel.challengerName : duel.targetName;
    const defenderName = isChallenger ? duel.targetName : duel.challengerName;

    const result = calculateInteractiveDamage(
      { attack: attackerStats.attack, critChance: attackerStats.critChance },
      { defense: defenderStats.defense },
      undefined,
      isFirstAttack
    );

    // Aplicar daño
    if (isChallenger) {
      duel.targetHealth = Math.max(0, duel.targetHealth - result.damage);
      duel.challengerStamina = Math.max(0, duel.challengerStamina - 5);
    } else {
      duel.challengerHealth = Math.max(0, duel.challengerHealth - result.damage);
      duel.targetStamina = Math.max(0, duel.targetStamina - 5);
    }

    // Agregar al log
    let logEntry = `⚔️ *${attackerName}* ataca`;
    if (result.isCrit) {
      logEntry += ` 💥CRÍTICO!`;
    }
    if (isFirstAttack) {
      logEntry += ` ⚡RÁPIDO!`;
    }
    logEntry += ` → *${result.damage}* daño a *${defenderName}*`;
    duel.log.push(logEntry);

    // Verificar si alguien murió
    if (duel.challengerHealth <= 0) {
      await finishDuel(duel, duel.targetJid, ctx, 'victory');
      return;
    }
    if (duel.targetHealth <= 0) {
      await finishDuel(duel, duel.challengerJid, ctx, 'victory');
      return;
    }

    // Cambiar turno
    duel.currentTurn = isChallenger ? 'target' : 'challenger';
    duel.turnStartTime = Date.now();

    // Mostrar estado actualizado
    const statusMsg = generateDuelStatusMessage(duel);
    await m.reply(statusMsg);

    // Configurar nuevo timeout
    const currentTurnTime = duel.turnStartTime;
    setTimeout(async () => {
      const currentDuel = activeDuels.get(groupJid);
      if (currentDuel && currentDuel.turnStartTime === currentTurnTime) {
        const loserJid = currentDuel.currentTurn === 'challenger' ? currentDuel.challengerJid : currentDuel.targetJid;
        const winnerJid = currentDuel.currentTurn === 'challenger' ? currentDuel.targetJid : currentDuel.challengerJid;
        await finishDuel(currentDuel, winnerJid, ctx, 'timeout');
      }
    }, TURN_TIMEOUT);
  }
};

/**
 * Plugin: Habilidad en duelo - Usar habilidad durante un duelo
 */
export const habilidadDueloPlugin: PluginHandler = {
  command: ['habilidad', 'skill', 'poder', 'hab'],
  tags: ['rpg'],
  help: ['habilidad [nombre] - Usa una habilidad en un duelo activo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const groupJid = m.chat;

    // Verificar si hay un duelo activo
    const duel = activeDuels.get(groupJid);
    if (!duel) {
      await m.reply(`${EMOJI.error} No hay ningún duelo activo en este grupo.`);
      return;
    }

    // Verificar si es el turno del jugador
    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) {
      await m.reply(`${EMOJI.error} No estás participando en este duelo.`);
      return;
    }

    const expectedTurn = duel.currentTurn === 'challenger' ? duel.challengerJid : duel.targetJid;
    const isFirstAttack = duel.log.length === 0;

    // Bonus de velocidad
    if (m.sender !== expectedTurn && isFirstAttack) {
      duel.currentTurn = isChallenger ? 'challenger' : 'target';
      duel.log.push(`⚡ *${isChallenger ? duel.challengerName : duel.targetName}* fue más rápido!`);
    } else if (m.sender !== expectedTurn) {
      await m.reply(`${EMOJI.error} No es tu turno. Espera a que tu oponente ataque.`);
      return;
    }

    // Obtener clase y habilidades
    const playerClass = isChallenger ? duel.challengerClass : duel.targetClass;
    const playerMana = isChallenger ? duel.challengerMana : duel.targetMana;
    const playerStamina = isChallenger ? duel.challengerStamina : duel.targetStamina;

    if (!playerClass) {
      await m.reply(`${EMOJI.error} No tienes una clase. Usa */clase* para elegir una.`);
      return;
    }

    const availableSkills = getAvailableSkills(playerClass, playerMana, playerStamina);
    if (availableSkills.length === 0) {
      await m.reply(`${EMOJI.error} No tienes suficiente maná o energía para usar habilidades.`);
      return;
    }

    // Buscar la habilidad por nombre (sin importar tildes)
    const skillName = args.join(' ').toLowerCase();
    let skill: Skill | undefined;

    if (skillName) {
      skill = availableSkills.find(s =>
        matchesIgnoreAccents(s.name, skillName) ||
        s.id.toLowerCase().includes(skillName)
      );
    }

    if (!skill) {
      // Mostrar habilidades disponibles
      let skillList = `${EMOJI.info} *Habilidades disponibles:*\n\n`;
      for (const s of availableSkills) {
        skillList += `${s.emoji} *${s.name}*\n`;
        skillList += `   ${s.description}\n`;
        skillList += `   💙 ${s.manaCost} maná | ⚡ ${s.staminaCost} energía\n\n`;
      }
      skillList += `📝 Usa: */habilidad [nombre]*`;
      await m.reply(skillList);
      return;
    }

    // Ejecutar habilidad
    const attackerStats = isChallenger ? duel.challengerStats : duel.targetStats;
    const defenderStats = isChallenger ? duel.targetStats : duel.challengerStats;
    const attackerName = isChallenger ? duel.challengerName : duel.targetName;
    const defenderName = isChallenger ? duel.targetName : duel.challengerName;

    const result = calculateInteractiveDamage(
      { attack: attackerStats.attack, critChance: attackerStats.critChance },
      { defense: defenderStats.defense },
      skill,
      isFirstAttack
    );

    // Aplicar daño y consumir recursos
    if (isChallenger) {
      duel.targetHealth = Math.max(0, duel.targetHealth - result.damage);
      duel.challengerMana -= skill.manaCost;
      duel.challengerStamina -= skill.staminaCost;
    } else {
      duel.challengerHealth = Math.max(0, duel.challengerHealth - result.damage);
      duel.targetMana -= skill.manaCost;
      duel.targetStamina -= skill.staminaCost;
    }

    // Agregar al log
    let logEntry = `${skill.emoji} *${attackerName}* usa *${skill.name}*`;
    if (result.isCrit) {
      logEntry += ` 💥CRÍTICO!`;
    }
    logEntry += ` → *${result.damage}* daño`;
    duel.log.push(logEntry);

    // Verificar si alguien murió
    if (duel.challengerHealth <= 0) {
      await finishDuel(duel, duel.targetJid, ctx, 'victory');
      return;
    }
    if (duel.targetHealth <= 0) {
      await finishDuel(duel, duel.challengerJid, ctx, 'victory');
      return;
    }

    // Cambiar turno
    duel.currentTurn = isChallenger ? 'target' : 'challenger';
    duel.turnStartTime = Date.now();

    // Mostrar estado actualizado
    const statusMsg = generateDuelStatusMessage(duel);
    await m.reply(statusMsg);

    // Configurar nuevo timeout
    const currentTurnTime = duel.turnStartTime;
    setTimeout(async () => {
      const currentDuel = activeDuels.get(groupJid);
      if (currentDuel && currentDuel.turnStartTime === currentTurnTime) {
        const loserJid = currentDuel.currentTurn === 'challenger' ? currentDuel.challengerJid : currentDuel.targetJid;
        const winnerJid = currentDuel.currentTurn === 'challenger' ? currentDuel.targetJid : currentDuel.challengerJid;
        await finishDuel(currentDuel, winnerJid, ctx, 'timeout');
      }
    }, TURN_TIMEOUT);
  }
};

/**
 * Plugin: Rendirse - Abandonar un duelo activo
 */
export const rendirsePlugin: PluginHandler = {
  command: ['rendirse', 'surrender', 'abandonar', 'huir'],
  tags: ['rpg'],
  help: ['rendirse - Abandona un duelo activo y pierde'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupJid = m.chat;

    const duel = activeDuels.get(groupJid);
    if (!duel) {
      await m.reply(`${EMOJI.error} No hay ningún duelo activo en este grupo.`);
      return;
    }

    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) {
      await m.reply(`${EMOJI.error} No estás participando en este duelo.`);
      return;
    }

    const winnerJid = isChallenger ? duel.targetJid : duel.challengerJid;
    await finishDuel(duel, winnerJid, ctx, 'surrender');
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
