/**
 * ⚔️ Plugin de Duelos PvP - RPG
 * Sistema de combate en tiempo real - El más rápido ataca
 * Sin turnos - Quien responde primero, golpea primero
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { ITEMS, CLASSES, SKILLS, type Skill } from '../types/rpg.js';
import { calculateTotalStats, getRankBenefits, getRoleByLevel, type UserRPG } from '../types/user.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';

/**
 * Estructura de un duelo activo - SIN TURNOS
 */
interface ActiveDuel {
  challengerJid: string;
  targetJid: string;
  challengerName: string;
  targetName: string;
  // Vida durante el duelo
  challengerHealth: number;
  targetHealth: number;
  challengerMaxHealth: number;
  targetMaxHealth: number;
  // Recursos
  challengerMana: number;
  targetMana: number;
  challengerStamina: number;
  targetStamina: number;
  // Stats calculados (incluyendo equipamiento)
  challengerStats: ReturnType<typeof calculateTotalStats>;
  targetStats: ReturnType<typeof calculateTotalStats>;
  // Clases y equipamiento
  challengerClass: string | null;
  targetClass: string | null;
  challengerWeapon: string | null;
  targetWeapon: string | null;
  challengerArmor: string | null;
  targetArmor: string | null;
  // Beneficios de rango
  challengerRankBenefits: ReturnType<typeof getRankBenefits>;
  targetRankBenefits: ReturnType<typeof getRankBenefits>;
  challengerRank: string;
  targetRank: string;
  // Sistema de racha - quien golpea 3 veces seguidas y mata, gana
  lastAttacker: 'challenger' | 'target' | null;
  consecutiveHits: number;
  // Apuesta y grupo
  bet: number;
  groupJid: string;
  startTime: number;
  log: string[];
  // Cooldown por jugador para evitar spam
  challengerLastAttack: number;
  targetLastAttack: number;
  // Cooldown de habilidades usadas (para evitar spam de la misma habilidad)
  challengerSkillCooldowns: Map<string, number>;
  targetSkillCooldowns: Map<string, number>;
}

/**
 * Pendientes de duelo
 */
const pendingDuels = new Map<string, { target: string; timestamp: number; bet: number }>();

/**
 * Duelos activos
 */
const activeDuels = new Map<string, ActiveDuel>();

/**
 * Cooldown mínimo entre ataques del mismo jugador (ms)
 */
const ATTACK_COOLDOWN = 1500;

/**
 * Tiempo máximo de duelo (2 minutos)
 */
const DUEL_TIMEOUT = 2 * 60 * 1000;

/**
 * Mensajes de victoria
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
 * Obtiene el arma equipada de una clase
 */
function getClassWeapon(user: UserRPG): { id: string; name: string; emoji: string; attack: number } | null {
  const weaponId = user.equipment.weapon;
  if (!weaponId) return null;

  const weapon = ITEMS[weaponId];
  if (!weapon || weapon.type !== 'weapon') return null;

  return {
    id: weaponId,
    name: weapon.name,
    emoji: weapon.emoji,
    attack: weapon.stats?.attack || 0
  };
}

/**
 * Obtiene la armadura equipada
 */
function getClassArmor(user: UserRPG): { id: string; name: string; emoji: string; defense: number } | null {
  const armorId = user.equipment.armor;
  if (!armorId) return null;

  const armor = ITEMS[armorId];
  if (!armor || armor.type !== 'armor') return null;

  return {
    id: armorId,
    name: armor.name,
    emoji: armor.emoji,
    defense: armor.stats?.defense || 0
  };
}

/**
 * Calcula el daño real basado en equipamiento y stats
 */
function calculateRealDamage(
  attackerStats: { attack: number; critChance: number },
  defenderStats: { defense: number },
  attackerWeapon: { attack: number } | null,
  defenderArmor: { defense: number } | null,
  skill: Skill | null,
  isConsecutiveHit: boolean,
  attackerPvpBonus: number,
  defenderPvpDefense: number,
  attackerCritBonus: number
): { damage: number; isCrit: boolean; skillUsed: string | null } {

  // Daño base = ataque del jugador + daño del arma
  let baseDamage = attackerStats.attack;
  if (attackerWeapon) {
    baseDamage += attackerWeapon.attack;
  }

  // Aplicar multiplicador de habilidad
  let skillUsed: string | null = null;
  if (skill && skill.effect.damageMultiplier) {
    baseDamage = Math.floor(baseDamage * skill.effect.damageMultiplier);
    skillUsed = skill.name;
  }

  // Bonus por golpes consecutivos (10% extra por cada golpe en racha)
  if (isConsecutiveHit) {
    baseDamage = Math.floor(baseDamage * 1.1);
  }

  // Aplicar bonus PvP del atacante
  const pvpMultiplier = 1 + (attackerPvpBonus / 100);
  baseDamage = Math.floor(baseDamage * pvpMultiplier);

  // Calcular defensa total = defensa del jugador + defensa de armadura
  let totalDefense = defenderStats.defense;
  if (defenderArmor) {
    totalDefense += defenderArmor.defense;
  }

  // Aplicar bonus de defensa PvP del defensor
  totalDefense = Math.floor(totalDefense * (1 + defenderPvpDefense / 100));

  // Reducción de daño (40% de la defensa)
  const reduction = totalDefense * 0.4;
  let damage = Math.max(1, Math.floor(baseDamage - reduction));

  // Varianza pequeña (±10%)
  const variance = randomInt(-10, 10) / 100;
  damage = Math.floor(damage * (1 + variance));

  // Crítico
  const totalCritChance = attackerStats.critChance + attackerCritBonus;
  const isCrit = randomInt(1, 100) <= totalCritChance;
  if (isCrit) {
    damage = Math.floor(damage * 1.75);
  }

  return { damage: Math.max(1, damage), isCrit, skillUsed };
}

/**
 * Obtiene las habilidades disponibles para la clase del jugador
 */
function getClassSkills(playerClass: string | null, mana: number, stamina: number): Skill[] {
  if (!playerClass) return [];

  const classInfo = CLASSES[playerClass as keyof typeof CLASSES];
  if (!classInfo) return [];

  return classInfo.skills
    .map(id => SKILLS[id])
    .filter(s => s && mana >= s.manaCost && stamina >= s.staminaCost);
}

/**
 * Formatea las habilidades disponibles de un jugador para el estado del duelo
 */
function formatPlayerSkills(
  playerClass: string | null,
  mana: number,
  stamina: number,
  skillCooldowns: Map<string, number>,
  now: number
): string {
  if (!playerClass) return '   _Sin clase_\n';

  const classInfo = CLASSES[playerClass as keyof typeof CLASSES];
  if (!classInfo) return '   _Sin clase_\n';

  const allSkills = classInfo.skills.map(id => SKILLS[id]).filter(Boolean);
  if (allSkills.length === 0) return '   _Sin habilidades_\n';

  let result = '';
  for (const skill of allSkills) {
    const cooldownEnd = skillCooldowns.get(skill.id) || 0;
    const isOnCooldown = now < cooldownEnd;
    const hasResources = mana >= skill.manaCost && stamina >= skill.staminaCost;

    if (isOnCooldown) {
      const remaining = Math.ceil((cooldownEnd - now) / 1000);
      result += `   ${skill.emoji} ~${skill.name}~ ⏳${remaining}s\n`;
    } else if (!hasResources) {
      result += `   ${skill.emoji} ~${skill.name}~ ❌\n`;
    } else {
      result += `   ${skill.emoji} *${skill.name}* ✅\n`;
    }
  }

  return result;
}

/**
 * Genera el mensaje del estado del duelo
 */
function generateDuelStatusMessage(duel: ActiveDuel): string {
  const now = Date.now();
  const challengerWeapon = duel.challengerWeapon ? ITEMS[duel.challengerWeapon] : null;
  const targetWeapon = duel.targetWeapon ? ITEMS[duel.targetWeapon] : null;
  const challengerArmor = duel.challengerArmor ? ITEMS[duel.challengerArmor] : null;
  const targetArmor = duel.targetArmor ? ITEMS[duel.targetArmor] : null;

  let msg = `⚔️ *DUELO EN TIEMPO REAL*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Jugador 1
  msg += `🗡️ *${duel.challengerName}*\n`;
  msg += `   ❤️ ${duel.challengerHealth}/${duel.challengerMaxHealth} | 💙 ${duel.challengerMana} | ⚡ ${duel.challengerStamina}\n`;
  if (challengerWeapon) {
    msg += `   ${challengerWeapon.emoji} ${challengerWeapon.name} (+${challengerWeapon.stats?.attack || 0})\n`;
  }
  if (challengerArmor) {
    msg += `   ${challengerArmor.emoji} ${challengerArmor.name} (+${challengerArmor.stats?.defense || 0})\n`;
  }
  // Habilidades del challenger
  msg += `   *Poderes:*\n`;
  msg += formatPlayerSkills(
    duel.challengerClass,
    duel.challengerMana,
    duel.challengerStamina,
    duel.challengerSkillCooldowns,
    now
  );

  msg += '\n';

  // Jugador 2
  msg += `🛡️ *${duel.targetName}*\n`;
  msg += `   ❤️ ${duel.targetHealth}/${duel.targetMaxHealth} | 💙 ${duel.targetMana} | ⚡ ${duel.targetStamina}\n`;
  if (targetWeapon) {
    msg += `   ${targetWeapon.emoji} ${targetWeapon.name} (+${targetWeapon.stats?.attack || 0})\n`;
  }
  if (targetArmor) {
    msg += `   ${targetArmor.emoji} ${targetArmor.name} (+${targetArmor.stats?.defense || 0})\n`;
  }
  // Habilidades del target
  msg += `   *Poderes:*\n`;
  msg += formatPlayerSkills(
    duel.targetClass,
    duel.targetMana,
    duel.targetStamina,
    duel.targetSkillCooldowns,
    now
  );

  msg += '\n';

  // Racha actual
  if (duel.consecutiveHits > 0 && duel.lastAttacker) {
    const streakPlayer = duel.lastAttacker === 'challenger' ? duel.challengerName : duel.targetName;
    msg += `🔥 *Racha:* ${streakPlayer} x${duel.consecutiveHits}\n\n`;
  }

  // Log de combate (últimos 3)
  if (duel.log.length > 0) {
    msg += `📜 *Combate:*\n`;
    for (const line of duel.log.slice(-3)) {
      msg += `   ${line}\n`;
    }
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `*Comandos:*\n`;
  msg += `• *g* o */golpe* - Ataque básico\n`;
  msg += `• Escribe el *nombre* de tu poder\n`;
  msg += `• */rendirse* - Abandonar\n`;
  msg += `\n💡 _¡El más rápido ataca! 3 seguidos = +daño_`;

  return msg;
}

/**
 * Finaliza un duelo y guarda la vida real
 */
async function finishDuel(
  duel: ActiveDuel,
  winnerJid: string,
  ctx: MessageContext,
  reason: 'victory' | 'surrender' | 'timeout'
): Promise<void> {
  const db = getDatabase();
  const loserJid = winnerJid === duel.challengerJid ? duel.targetJid : duel.challengerJid;

  const winner = db.getUser(winnerJid);
  const loser = db.getUser(loserJid);

  const winnerName = winnerJid === duel.challengerJid ? duel.challengerName : duel.targetName;
  const loserName = winnerJid === duel.challengerJid ? duel.targetName : duel.challengerName;

  // Obtener vida final de cada jugador
  const challengerFinalHealth = Math.max(0, duel.challengerHealth);
  const targetFinalHealth = Math.max(0, duel.targetHealth);

  // Calcular recompensas base
  const baseExpReward = 300 + Math.floor(loser.level * 15);
  let expReward = baseExpReward + randomInt(0, 150);

  // Aplicar multiplicadores de modos globales
  let modeMessages: string[] = [];

  // Bonus Mode
  if (globalModes.bonusMode.active) {
    const bonusExp = Math.floor(expReward * (globalModes.bonusMode.expMultiplier - 1));
    expReward += bonusExp;
    modeMessages.push(`🎁 Modo Bonus: +${bonusExp} XP`);
  }

  // PvP Mode - Bonus específico para duelos
  if (globalModes.pvpMode.active) {
    const pvpExp = Math.floor(expReward * (globalModes.pvpMode.damageMultiplier - 1));
    expReward += pvpExp;
    modeMessages.push(`⚔️ Modo PvP: +${pvpExp} XP`);
  }

  // Chaos Mode
  if (globalModes.chaosMode.active) {
    const chaosExp = Math.floor(expReward * (globalModes.chaosMode.multiplier - 1));
    expReward += chaosExp;
    modeMessages.push(`🌀 Modo Caos: +${chaosExp} XP`);
  }

  // Actualizar stats del ganador
  const winnerStats = { ...winner.combatStats };
  winnerStats.pvpWins++;

  // GUARDAR VIDA REAL DEL GANADOR
  const winnerFinalHealth = winnerJid === duel.challengerJid ? challengerFinalHealth : targetFinalHealth;

  db.updateUser(winnerJid, {
    exp: winner.exp + expReward,
    money: winner.money + duel.bet,
    health: winnerFinalHealth, // ← VIDA REAL GUARDADA
    combatStats: winnerStats
  });

  // Actualizar stats del perdedor
  const loserStats = { ...loser.combatStats };
  loserStats.pvpLosses++;

  // GUARDAR VIDA REAL DEL PERDEDOR (0 o lo que quedó)
  const loserFinalHealth = loserJid === duel.challengerJid ? challengerFinalHealth : targetFinalHealth;

  db.updateUser(loserJid, {
    money: Math.max(0, loser.money - duel.bet),
    health: Math.max(1, loserFinalHealth), // Mínimo 1 de vida para no quedar muerto
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
      reasonText = `⏰ El duelo expiró. *${winnerName}* gana por más vida restante!`;
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

  // Mostrar modos activos
  if (modeMessages.length > 0) {
    resultMsg += `\n🎮 *Bonificaciones:*\n`;
    resultMsg += modeMessages.map(msg => `   ${msg}`).join('\n') + '\n';
  }

  resultMsg += `\n❤️ *Salud final (GUARDADA):*\n`;
  resultMsg += `   ${duel.challengerName}: *${challengerFinalHealth}* HP\n`;
  resultMsg += `   ${duel.targetName}: *${targetFinalHealth}* HP\n\n`;
  resultMsg += `💡 _Usa pociones para recuperar vida_`;

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
    'Sistema en TIEMPO REAL - ¡El más rápido ataca!',
    'Sin turnos - Golpea cuando puedas',
    '3 golpes consecutivos = daño extra'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const challenger = db.getUser(m.sender);
    const groupJid = m.chat;

    // Verificar modos globales expirados
    checkExpiredModes();

    // Verificar si ya hay un duelo activo
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

    // Parsear apuesta
    let bet = 0;
    const betArg = args.find(a => /^\d+$/.test(a));
    if (betArg) {
      bet = Math.min(50000, Math.max(100, parseInt(betArg)));

      if (challenger.money < bet) {
        await m.reply(`${EMOJI.error} No tienes suficiente dinero para esa apuesta.`);
        return;
      }
      if (target.money < bet) {
        await m.reply(`${EMOJI.error} *${target.name}* no tiene suficiente dinero.`);
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

    // Limpiar desafíos antiguos
    setTimeout(() => {
      const pending = pendingDuels.get(m.sender);
      if (pending && now === pending.timestamp) {
        pendingDuels.delete(m.sender);
      }
    }, 2 * 60 * 1000);

    // Obtener equipamiento para mostrar
    const challengerWeapon = getClassWeapon(challenger);
    const challengerArmor = getClassArmor(challenger);
    const targetWeapon = getClassWeapon(target);
    const targetArmor = getClassArmor(target);

    const targetName = targetJid.split('@')[0];
    let challengeMsg = `⚔️ *¡DESAFÍO DE DUELO!*\n`;
    challengeMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    challengeMsg += `🗡️ *${challenger.name}* (Nv.${challenger.level})\n`;
    challengeMsg += `   ❤️ ${challenger.health}/${challenger.maxHealth}\n`;
    if (challenger.playerClass) {
      const classInfo = CLASSES[challenger.playerClass as keyof typeof CLASSES];
      challengeMsg += `   ${classInfo?.emoji} ${classInfo?.name}\n`;
    }
    if (challengerWeapon) {
      challengeMsg += `   ${challengerWeapon.emoji} ${challengerWeapon.name}\n`;
    }
    if (challengerArmor) {
      challengeMsg += `   ${challengerArmor.emoji} ${challengerArmor.name}\n`;
    }

    challengeMsg += `\n   ⚡ VS ⚡\n\n`;

    challengeMsg += `🛡️ *${target.name}* (Nv.${target.level})\n`;
    challengeMsg += `   ❤️ ${target.health}/${target.maxHealth}\n`;
    if (target.playerClass) {
      const classInfo = CLASSES[target.playerClass as keyof typeof CLASSES];
      challengeMsg += `   ${classInfo?.emoji} ${classInfo?.name}\n`;
    }
    if (targetWeapon) {
      challengeMsg += `   ${targetWeapon.emoji} ${targetWeapon.name}\n`;
    }
    if (targetArmor) {
      challengeMsg += `   ${targetArmor.emoji} ${targetArmor.name}\n`;
    }

    challengeMsg += '\n';
    if (bet > 0) {
      challengeMsg += `💰 *Apuesta:* ${formatNumber(bet)} monedas\n\n`;
    }

    challengeMsg += `⚡ *¡COMBATE EN TIEMPO REAL!*\n`;
    challengeMsg += `   • Sin turnos - El más rápido ataca\n`;
    challengeMsg += `   • Usa tu arma y habilidades de clase\n`;
    challengeMsg += `   • 3 golpes seguidos = daño extra\n`;
    challengeMsg += `   • ¡La vida se guarda al final!\n\n`;

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
  help: ['aceptar - Acepta un desafío de duelo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const accepter = db.getUser(m.sender);
    const groupJid = m.chat;

    if (activeDuels.has(groupJid)) {
      await m.reply(`${EMOJI.error} Ya hay un duelo en curso.`);
      return;
    }

    // Buscar desafío pendiente
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
      await m.reply(`${EMOJI.error} No tienes ningún desafío pendiente.`);
      return;
    }

    const challenger = db.getUser(challengerJid);

    // Verificaciones
    if (accepter.health < 30) {
      await m.reply(`${EMOJI.error} Estás muy herido. Cúrate primero.`);
      return;
    }

    if (challenger.health < 30) {
      await m.reply(`${EMOJI.error} *${challenger.name}* ya no puede pelear.`);
      pendingDuels.delete(challengerJid);
      return;
    }

    if (duelInfo.bet > 0) {
      if (accepter.money < duelInfo.bet || challenger.money < duelInfo.bet) {
        await m.reply(`${EMOJI.error} Fondos insuficientes para la apuesta.`);
        pendingDuels.delete(challengerJid);
        return;
      }
    }

    pendingDuels.delete(challengerJid);
    await m.react('⚔️');

    // Calcular stats
    const challengerStats = calculateTotalStats(challenger, ITEMS);
    const accepterStats = calculateTotalStats(accepter, ITEMS);

    // Obtener beneficios de rango
    const challengerRankBenefits = getRankBenefits(challenger.level);
    const targetRankBenefits = getRankBenefits(accepter.level);
    const challengerRank = getRoleByLevel(challenger.level);
    const targetRank = getRoleByLevel(accepter.level);

    // Obtener equipamiento
    const challengerWeapon = getClassWeapon(challenger);
    const challengerArmor = getClassArmor(challenger);
    const targetWeapon = getClassWeapon(accepter);
    const targetArmor = getClassArmor(accepter);

    const now = Date.now();

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
      challengerWeapon: challengerWeapon?.id || null,
      targetWeapon: targetWeapon?.id || null,
      challengerArmor: challengerArmor?.id || null,
      targetArmor: targetArmor?.id || null,
      challengerRankBenefits,
      targetRankBenefits,
      challengerRank,
      targetRank,
      lastAttacker: null,
      consecutiveHits: 0,
      bet: duelInfo.bet,
      groupJid,
      startTime: now,
      log: [],
      challengerLastAttack: 0,
      targetLastAttack: 0,
      challengerSkillCooldowns: new Map(),
      targetSkillCooldowns: new Map()
    };

    activeDuels.set(groupJid, newDuel);

    // Mensaje de inicio
    let startMsg = `⚔️ *¡DUELO INICIADO!*\n`;
    startMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    startMsg += `🗡️ *${challenger.name}* VS 🛡️ *${accepter.name}*\n\n`;
    startMsg += `⚡ *¡COMBATE EN TIEMPO REAL!*\n`;
    startMsg += `   • ¡El más rápido ataca primero!\n`;
    startMsg += `   • Usa */atacar* o */poder [habilidad]*\n`;
    startMsg += `   • ¡3 golpes seguidos dan daño extra!\n\n`;

    await m.reply(startMsg);

    // Enviar estado
    const statusMsg = generateDuelStatusMessage(newDuel);
    await m.reply(statusMsg);

    // Timeout del duelo
    setTimeout(async () => {
      const duel = activeDuels.get(groupJid);
      if (duel && duel.startTime === now) {
        // El que tenga más vida gana
        const winnerJid = duel.challengerHealth >= duel.targetHealth
          ? duel.challengerJid
          : duel.targetJid;
        await finishDuel(duel, winnerJid, ctx, 'timeout');
      }
    }, DUEL_TIMEOUT);
  }
};

/**
 * Plugin: Golpe en duelo - Ataque con arma equipada
 * Comandos separados de /atacar (que es para monstruos)
 */
export const atacarDueloPlugin: PluginHandler = {
  command: ['golpe', 'golpear', 'hit', 'g'],
  tags: ['rpg'],
  help: ['golpe - Ataca con tu arma en un duelo activo (alias: g, hit)'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupJid = m.chat;

    const duel = activeDuels.get(groupJid);
    if (!duel) return; // Puede ser otro comando, no responder

    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) {
      await m.reply(`${EMOJI.error} No estás en este duelo.`);
      return;
    }

    const now = Date.now();
    const lastAttack = isChallenger ? duel.challengerLastAttack : duel.targetLastAttack;

    // Cooldown anti-spam
    if (now - lastAttack < ATTACK_COOLDOWN) {
      const remaining = Math.ceil((ATTACK_COOLDOWN - (now - lastAttack)) / 1000);
      await m.reply(`⏳ Espera ${remaining}s para atacar de nuevo.`);
      return;
    }

    // Verificar stamina
    const currentStamina = isChallenger ? duel.challengerStamina : duel.targetStamina;
    if (currentStamina < 5) {
      await m.reply(`${EMOJI.error} ¡Sin energía! Necesitas 5 ⚡ para atacar.`);
      return;
    }

    // Actualizar tiempo de ataque
    if (isChallenger) {
      duel.challengerLastAttack = now;
    } else {
      duel.targetLastAttack = now;
    }

    // Obtener stats y equipamiento
    const attackerStats = isChallenger ? duel.challengerStats : duel.targetStats;
    const defenderStats = isChallenger ? duel.targetStats : duel.challengerStats;
    const attackerName = isChallenger ? duel.challengerName : duel.targetName;

    const attackerWeaponId = isChallenger ? duel.challengerWeapon : duel.targetWeapon;
    const defenderArmorId = isChallenger ? duel.targetArmor : duel.challengerArmor;

    const attackerWeapon = attackerWeaponId ? { attack: ITEMS[attackerWeaponId]?.stats?.attack || 0 } : null;
    const defenderArmor = defenderArmorId ? { defense: ITEMS[defenderArmorId]?.stats?.defense || 0 } : null;

    const attackerRankBenefits = isChallenger ? duel.challengerRankBenefits : duel.targetRankBenefits;
    const defenderRankBenefits = isChallenger ? duel.targetRankBenefits : duel.challengerRankBenefits;

    // Verificar racha
    const currentAttacker = isChallenger ? 'challenger' : 'target';
    const isConsecutive = duel.lastAttacker === currentAttacker;

    // Calcular daño real
    const result = calculateRealDamage(
      { attack: attackerStats.attack, critChance: attackerStats.critChance },
      { defense: defenderStats.defense },
      attackerWeapon,
      defenderArmor,
      null,
      isConsecutive && duel.consecutiveHits >= 2,
      attackerRankBenefits.pvpDamageBonus,
      defenderRankBenefits.pvpDefenseBonus,
      attackerRankBenefits.critBonus
    );

    // Aplicar daño y consumir stamina
    if (isChallenger) {
      duel.targetHealth = Math.max(0, duel.targetHealth - result.damage);
      duel.challengerStamina = Math.max(0, duel.challengerStamina - 5);
    } else {
      duel.challengerHealth = Math.max(0, duel.challengerHealth - result.damage);
      duel.targetStamina = Math.max(0, duel.targetStamina - 5);
    }

    // Actualizar racha
    if (duel.lastAttacker === currentAttacker) {
      duel.consecutiveHits++;
    } else {
      duel.lastAttacker = currentAttacker;
      duel.consecutiveHits = 1;
    }

    // Obtener nombre del arma para el log
    const weaponName = attackerWeaponId ? ITEMS[attackerWeaponId]?.name : 'puños';
    const weaponEmoji = attackerWeaponId ? ITEMS[attackerWeaponId]?.emoji : '👊';

    // Agregar al log
    let logEntry = `${weaponEmoji} *${attackerName}* ataca con *${weaponName}*`;
    if (result.isCrit) {
      logEntry += ` 💥CRÍTICO!`;
    }
    if (duel.consecutiveHits >= 3) {
      logEntry += ` 🔥x${duel.consecutiveHits}`;
    }
    logEntry += ` → *${result.damage}* daño`;
    duel.log.push(logEntry);

    // Verificar victoria
    if (duel.challengerHealth <= 0) {
      await finishDuel(duel, duel.targetJid, ctx, 'victory');
      return;
    }
    if (duel.targetHealth <= 0) {
      await finishDuel(duel, duel.challengerJid, ctx, 'victory');
      return;
    }

    // Mostrar estado
    const statusMsg = generateDuelStatusMessage(duel);
    await m.reply(statusMsg);
  }
};

/**
 * Busca si el texto contiene el nombre de una habilidad
 */
function findSkillByText(text: string, playerClass: string | null): Skill | null {
  if (!playerClass) return null;

  const classInfo = CLASSES[playerClass as keyof typeof CLASSES];
  if (!classInfo) return null;

  const normalizedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  for (const skillId of classInfo.skills) {
    const skill = SKILLS[skillId];
    if (!skill) continue;

    const skillNameNorm = skill.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const skillIdNorm = skill.id.toLowerCase();

    // Coincidencia exacta o parcial
    if (
      normalizedText === skillNameNorm ||
      normalizedText === skillIdNorm ||
      normalizedText.includes(skillNameNorm) ||
      skillNameNorm.includes(normalizedText)
    ) {
      return skill;
    }
  }

  return null;
}

/**
 * Ejecuta una habilidad en el duelo (función compartida)
 */
async function executeSkill(
  ctx: MessageContext,
  duel: ActiveDuel,
  skill: Skill,
  isChallenger: boolean
): Promise<boolean> {
  const { m } = ctx;
  const now = Date.now();

  const playerMana = isChallenger ? duel.challengerMana : duel.targetMana;
  const playerStamina = isChallenger ? duel.challengerStamina : duel.targetStamina;
  const skillCooldowns = isChallenger ? duel.challengerSkillCooldowns : duel.targetSkillCooldowns;
  const lastAttack = isChallenger ? duel.challengerLastAttack : duel.targetLastAttack;

  // Cooldown anti-spam general
  if (now - lastAttack < ATTACK_COOLDOWN) {
    const remaining = Math.ceil((ATTACK_COOLDOWN - (now - lastAttack)) / 1000);
    await m.reply(`⏳ Espera ${remaining}s.`);
    return false;
  }

  // Verificar recursos
  if (playerMana < skill.manaCost || playerStamina < skill.staminaCost) {
    await m.reply(`${EMOJI.error} Sin recursos para *${skill.name}* (💙${skill.manaCost} ⚡${skill.staminaCost})`);
    return false;
  }

  // Verificar cooldown de habilidad
  const skillCooldownEnd = skillCooldowns.get(skill.id) || 0;
  if (now < skillCooldownEnd) {
    const remaining = Math.ceil((skillCooldownEnd - now) / 1000);
    await m.reply(`⏳ *${skill.name}* en cooldown. Espera *${remaining}s*`);
    return false;
  }

  // Actualizar tiempo de ataque
  if (isChallenger) {
    duel.challengerLastAttack = now;
  } else {
    duel.targetLastAttack = now;
  }

  // Obtener stats
  const attackerStats = isChallenger ? duel.challengerStats : duel.targetStats;
  const defenderStats = isChallenger ? duel.targetStats : duel.challengerStats;
  const attackerName = isChallenger ? duel.challengerName : duel.targetName;

  const attackerWeaponId = isChallenger ? duel.challengerWeapon : duel.targetWeapon;
  const defenderArmorId = isChallenger ? duel.targetArmor : duel.challengerArmor;

  const attackerWeapon = attackerWeaponId ? { attack: ITEMS[attackerWeaponId]?.stats?.attack || 0 } : null;
  const defenderArmor = defenderArmorId ? { defense: ITEMS[defenderArmorId]?.stats?.defense || 0 } : null;

  const attackerRankBenefits = isChallenger ? duel.challengerRankBenefits : duel.targetRankBenefits;
  const defenderRankBenefits = isChallenger ? duel.targetRankBenefits : duel.challengerRankBenefits;

  // Verificar racha
  const currentAttacker = isChallenger ? 'challenger' : 'target';
  const isConsecutive = duel.lastAttacker === currentAttacker;

  // Calcular daño con habilidad
  const result = calculateRealDamage(
    { attack: attackerStats.attack, critChance: attackerStats.critChance },
    { defense: defenderStats.defense },
    attackerWeapon,
    defenderArmor,
    skill,
    isConsecutive && duel.consecutiveHits >= 2,
    attackerRankBenefits.pvpDamageBonus,
    defenderRankBenefits.pvpDefenseBonus,
    attackerRankBenefits.critBonus
  );

  // Aplicar cooldown de habilidad
  const skillCooldownTime = (skill.cooldown || 2) * 3000;
  skillCooldowns.set(skill.id, now + skillCooldownTime);

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

  // Aplicar curación si la habilidad lo tiene
  if (skill.effect.heal && result.damage > 0) {
    const healAmount = Math.floor(result.damage * (skill.effect.heal / 100));
    if (isChallenger) {
      duel.challengerHealth = Math.min(duel.challengerMaxHealth, duel.challengerHealth + healAmount);
    } else {
      duel.targetHealth = Math.min(duel.targetMaxHealth, duel.targetHealth + healAmount);
    }
  }

  // Actualizar racha
  if (duel.lastAttacker === currentAttacker) {
    duel.consecutiveHits++;
  } else {
    duel.lastAttacker = currentAttacker;
    duel.consecutiveHits = 1;
  }

  // Agregar al log
  let logEntry = `${skill.emoji} *${attackerName}* → *${skill.name}*`;
  if (result.isCrit) {
    logEntry += ` 💥`;
  }
  if (duel.consecutiveHits >= 3) {
    logEntry += ` 🔥x${duel.consecutiveHits}`;
  }
  logEntry += ` *${result.damage}*`;

  if (skill.effect.heal && result.damage > 0) {
    const healAmount = Math.floor(result.damage * (skill.effect.heal / 100));
    logEntry += ` +${healAmount}❤️`;
  }

  duel.log.push(logEntry);

  // Verificar victoria
  if (duel.challengerHealth <= 0) {
    await finishDuel(duel, duel.targetJid, ctx, 'victory');
    return true;
  }
  if (duel.targetHealth <= 0) {
    await finishDuel(duel, duel.challengerJid, ctx, 'victory');
    return true;
  }

  // Mostrar estado
  const statusMsg = generateDuelStatusMessage(duel);
  await m.reply(statusMsg);
  return true;
}

/**
 * Plugin: Detectar habilidades por nombre directo (sin comando)
 * Detecta cuando alguien escribe el nombre de una habilidad durante un duelo
 */
export const skillDetectorPlugin: PluginHandler = {
  // Regex que captura nombres de habilidades de todas las clases
  command: /^(golpe.?brutal|escudo.?defensor|grito.?guerra|bola.?fuego|rayo.?arcano|escudo.?magico|ataque.?furtivo|evadir|robo.?vital|disparo.?preciso|lluvia.?flechas|trampa.?cazador|fuego|rayo|brutal|furtivo|flechas|trampa)$/i,
  tags: ['rpg'],
  help: ['Escribe el nombre de tu habilidad directamente para usarla'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupJid = m.chat;

    const duel = activeDuels.get(groupJid);
    if (!duel) return; // No hay duelo, ignorar silenciosamente

    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) return; // No es participante, ignorar

    const playerClass = isChallenger ? duel.challengerClass : duel.targetClass;
    const messageText = m.text || '';

    // Buscar si el mensaje es una habilidad válida para la clase del jugador
    const skill = findSkillByText(messageText, playerClass);
    if (!skill) return; // No es una habilidad de su clase, ignorar

    // Ejecutar la habilidad
    await executeSkill(ctx, duel, skill, isChallenger);
  }
};

/**
 * Plugin: Poder/Habilidad en duelo - Usar habilidad de clase con comando
 */
export const poderDueloPlugin: PluginHandler = {
  command: ['poder', 'habilidad', 'skill', 'p'],
  tags: ['rpg'],
  help: ['poder [nombre] - Usa una habilidad (o escribe el nombre directamente)'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const groupJid = m.chat;

    const duel = activeDuels.get(groupJid);
    if (!duel) {
      await m.reply(`${EMOJI.error} No hay duelo activo.`);
      return;
    }

    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) {
      await m.reply(`${EMOJI.error} No estás en este duelo.`);
      return;
    }

    const now = Date.now();
    const lastAttack = isChallenger ? duel.challengerLastAttack : duel.targetLastAttack;

    // Cooldown
    if (now - lastAttack < ATTACK_COOLDOWN) {
      const remaining = Math.ceil((ATTACK_COOLDOWN - (now - lastAttack)) / 1000);
      await m.reply(`⏳ Espera ${remaining}s.`);
      return;
    }

    // Obtener clase y habilidades
    const playerClass = isChallenger ? duel.challengerClass : duel.targetClass;
    const playerMana = isChallenger ? duel.challengerMana : duel.targetMana;
    const playerStamina = isChallenger ? duel.challengerStamina : duel.targetStamina;

    if (!playerClass) {
      await m.reply(`${EMOJI.error} No tienes clase. Usa */clase* para elegir una.`);
      return;
    }

    const availableSkills = getClassSkills(playerClass, playerMana, playerStamina);

    if (availableSkills.length === 0) {
      await m.reply(`${EMOJI.error} Sin maná/energía para habilidades.`);
      return;
    }

    // Buscar habilidad
    const skillName = args.join(' ').toLowerCase();
    let skill: Skill | undefined;

    if (skillName) {
      skill = availableSkills.find(s =>
        s.name.toLowerCase().includes(skillName) ||
        s.id.toLowerCase().includes(skillName)
      );
    }

    if (!skill) {
      // Mostrar habilidades disponibles de la clase con cooldowns
      const classInfo = CLASSES[playerClass as keyof typeof CLASSES];
      const skillCooldowns = isChallenger ? duel.challengerSkillCooldowns : duel.targetSkillCooldowns;
      let skillList = `${classInfo?.emoji} *Habilidades de ${classInfo?.name}:*\n\n`;

      for (const s of availableSkills) {
        const cooldownEnd = skillCooldowns.get(s.id) || 0;
        const isOnCooldown = now < cooldownEnd;
        const cooldownRemaining = isOnCooldown ? Math.ceil((cooldownEnd - now) / 1000) : 0;

        skillList += `${s.emoji} *${s.name}*`;
        if (isOnCooldown) {
          skillList += ` ⏳ ${cooldownRemaining}s\n`;
        } else {
          skillList += ` ✅\n`;
        }
        skillList += `   ${s.description}\n`;
        skillList += `   💙 ${s.manaCost} | ⚡ ${s.staminaCost}\n\n`;
      }

      skillList += `📝 Usa: */poder [nombre]*\n`;
      skillList += `⚠️ _Cada habilidad tiene cooldown propio_`;
      await m.reply(skillList);
      return;
    }

    // Verificar cooldown de la habilidad específica
    const skillCooldowns = isChallenger ? duel.challengerSkillCooldowns : duel.targetSkillCooldowns;
    const skillCooldownEnd = skillCooldowns.get(skill.id) || 0;

    if (now < skillCooldownEnd) {
      const remaining = Math.ceil((skillCooldownEnd - now) / 1000);
      await m.reply(`⏳ *${skill.name}* en cooldown. Espera *${remaining}s* o usa otra habilidad.`);
      return;
    }

    // Actualizar tiempo de ataque
    if (isChallenger) {
      duel.challengerLastAttack = now;
    } else {
      duel.targetLastAttack = now;
    }

    // Obtener stats
    const attackerStats = isChallenger ? duel.challengerStats : duel.targetStats;
    const defenderStats = isChallenger ? duel.targetStats : duel.challengerStats;
    const attackerName = isChallenger ? duel.challengerName : duel.targetName;

    const attackerWeaponId = isChallenger ? duel.challengerWeapon : duel.targetWeapon;
    const defenderArmorId = isChallenger ? duel.targetArmor : duel.challengerArmor;

    const attackerWeapon = attackerWeaponId ? { attack: ITEMS[attackerWeaponId]?.stats?.attack || 0 } : null;
    const defenderArmor = defenderArmorId ? { defense: ITEMS[defenderArmorId]?.stats?.defense || 0 } : null;

    const attackerRankBenefits = isChallenger ? duel.challengerRankBenefits : duel.targetRankBenefits;
    const defenderRankBenefits = isChallenger ? duel.targetRankBenefits : duel.challengerRankBenefits;

    // Verificar racha
    const currentAttacker = isChallenger ? 'challenger' : 'target';
    const isConsecutive = duel.lastAttacker === currentAttacker;

    // Calcular daño con habilidad
    const result = calculateRealDamage(
      { attack: attackerStats.attack, critChance: attackerStats.critChance },
      { defense: defenderStats.defense },
      attackerWeapon,
      defenderArmor,
      skill,
      isConsecutive && duel.consecutiveHits >= 2,
      attackerRankBenefits.pvpDamageBonus,
      defenderRankBenefits.pvpDefenseBonus,
      attackerRankBenefits.critBonus
    );

    // Aplicar daño y consumir recursos
    // Cooldown de habilidad: skill.cooldown son "turnos", convertimos a segundos (3s por turno)
    const skillCooldownTime = (skill.cooldown || 2) * 3000;
    skillCooldowns.set(skill.id, now + skillCooldownTime);

    if (isChallenger) {
      duel.targetHealth = Math.max(0, duel.targetHealth - result.damage);
      duel.challengerMana -= skill.manaCost;
      duel.challengerStamina -= skill.staminaCost;
    } else {
      duel.challengerHealth = Math.max(0, duel.challengerHealth - result.damage);
      duel.targetMana -= skill.manaCost;
      duel.targetStamina -= skill.staminaCost;
    }

    // Aplicar efecto de curación si la habilidad lo tiene (robo vital)
    if (skill.effect.heal && result.damage > 0) {
      const healAmount = Math.floor(result.damage * (skill.effect.heal / 100));
      if (isChallenger) {
        duel.challengerHealth = Math.min(duel.challengerMaxHealth, duel.challengerHealth + healAmount);
      } else {
        duel.targetHealth = Math.min(duel.targetMaxHealth, duel.targetHealth + healAmount);
      }
    }

    // Actualizar racha
    if (duel.lastAttacker === currentAttacker) {
      duel.consecutiveHits++;
    } else {
      duel.lastAttacker = currentAttacker;
      duel.consecutiveHits = 1;
    }

    // Agregar al log
    let logEntry = `${skill.emoji} *${attackerName}* usa *${skill.name}*`;
    if (result.isCrit) {
      logEntry += ` 💥CRÍTICO!`;
    }
    if (duel.consecutiveHits >= 3) {
      logEntry += ` 🔥x${duel.consecutiveHits}`;
    }
    logEntry += ` → *${result.damage}* daño`;

    if (skill.effect.heal && result.damage > 0) {
      const healAmount = Math.floor(result.damage * (skill.effect.heal / 100));
      logEntry += ` (+${healAmount}❤️)`;
    }

    duel.log.push(logEntry);

    // Verificar victoria
    if (duel.challengerHealth <= 0) {
      await finishDuel(duel, duel.targetJid, ctx, 'victory');
      return;
    }
    if (duel.targetHealth <= 0) {
      await finishDuel(duel, duel.challengerJid, ctx, 'victory');
      return;
    }

    // Mostrar estado
    const statusMsg = generateDuelStatusMessage(duel);
    await m.reply(statusMsg);
  }
};

/**
 * Plugin: Rendirse
 */
export const rendirsePlugin: PluginHandler = {
  command: ['rendirse', 'surrender', 'abandonar', 'huir'],
  tags: ['rpg'],
  help: ['rendirse - Abandona un duelo activo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupJid = m.chat;

    const duel = activeDuels.get(groupJid);
    if (!duel) {
      await m.reply(`${EMOJI.error} No hay duelo activo.`);
      return;
    }

    const isChallenger = m.sender === duel.challengerJid;
    const isTarget = m.sender === duel.targetJid;

    if (!isChallenger && !isTarget) {
      await m.reply(`${EMOJI.error} No estás en este duelo.`);
      return;
    }

    const winnerJid = isChallenger ? duel.targetJid : duel.challengerJid;
    await finishDuel(duel, winnerJid, ctx, 'surrender');
  }
};

/**
 * Plugin: Rechazar
 */
export const rechazarPlugin: PluginHandler = {
  command: ['rechazar', 'decline', 'no', 'negar'],
  tags: ['rpg'],
  help: ['rechazar - Rechaza un desafío de duelo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let challengerJid: string | null = null;

    for (const [cJid, info] of pendingDuels.entries()) {
      if (info.target === m.sender) {
        challengerJid = cJid;
        break;
      }
    }

    if (!challengerJid) {
      await m.reply(`${EMOJI.info} No tienes desafíos pendientes.`);
      return;
    }

    const challenger = db.getUser(challengerJid);
    pendingDuels.delete(challengerJid);

    await m.reply(
      `${EMOJI.error} *${user.name}* rechazó el duelo de *${challenger.name}*.\n\n` +
      `💔 _Quizás otro día..._`
    );
    await m.react('❌');
  }
};

export default dueloPlugin;
