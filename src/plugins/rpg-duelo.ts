/**
 * Plugin de Duelos PvP - RPG
 * Sistema de combate en tiempo real MEJORADO
 * Más interactivo, balanceado y estratégico
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { ITEMS, CLASSES, SKILLS, type Skill } from '../types/rpg.js';
import { calculateTotalStats, getRankBenefits, getRoleByLevel, type UserRPG } from '../types/user.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';
import { applyDeathPenalty, generateIMSSMessage } from './rpg-bombardear.js';
import { PVP } from '../constants/rpg.js';

// ==================== CONFIGURACIÓN DE BALANCE PVP ====================

/**
 * Multiplicador de vida en duelos (vida_real * este valor)
 * Hace que los duelos duren más tiempo
 */
const PVP_HEALTH_MULTIPLIER = PVP.HEALTH_MULTIPLIER;

/**
 * Multiplicador de daño base en PvP (reduce el daño general)
 * Evita que un golpe mate instantáneamente
 */
const PVP_DAMAGE_MULTIPLIER = PVP.DAMAGE_MULTIPLIER;

/**
 * Multiplicadores de habilidades REDUCIDOS para PvP
 */
const PVP_SKILL_MULTIPLIERS: Record<string, number> = {
  // Guerrero - Balanceado para resistencia
  golpe_brutal: 1.25,     
  escudo_defensor: 1.0,   
  grito_guerra: 1.0,       
  // Mago - Daño alto pero muy reducido en PvP
  bola_fuego: 1.35,        
  rayo_arcano: 1.25,       
  escudo_magico: 1.0,    
  // Ladrón - Daño moderado, robo vital útil
  ataque_furtivo: 1.4,     
  evadir: 1.0,             
  robo_vital: 1.15,        
  // Arquero - Daño consistente pero no letal
  disparo_preciso: 1.2,   
  lluvia_flechas: 1.35,  
  trampa_cazador: 1.0    
};

/**
 * Regeneración de recursos durante el duelo
 */
const REGEN_PER_ACTION = {
  mana: 5,      // Regenera maná por cada acción
  stamina: 3    // Regenera stamina por cada acción
};

/**
 * Alias y atajos para habilidades (facilita el uso en duelos)
 * Se pueden usar en lugar del nombre completo de la habilidad
 */
const SKILL_ALIASES: Record<string, string> = {
  // Guerrero
  'brutal': 'golpe_brutal',
  'gb': 'golpe_brutal',
  'escudo': 'escudo_defensor',
  'defensor': 'escudo_defensor',
  'ed': 'escudo_defensor',
  'grito': 'grito_guerra',
  'guerra': 'grito_guerra',
  'gg': 'grito_guerra',
  // Mago
  'fuego': 'bola_fuego',
  'bola': 'bola_fuego',
  'bf': 'bola_fuego',
  'rayo': 'rayo_arcano',
  'arcano': 'rayo_arcano',
  'ra': 'rayo_arcano',
  'escudomagico': 'escudo_magico',
  'magico': 'escudo_magico',
  'em': 'escudo_magico',
  // Ladrón
  'furtivo': 'ataque_furtivo',
  'af': 'ataque_furtivo',
  'evadir': 'evadir',
  'esquivar': 'evadir',
  'ev': 'evadir',
  'robo': 'robo_vital',
  'vital': 'robo_vital',
  'rv': 'robo_vital',
  'robovital': 'robo_vital',
  // Arquero
  'disparo': 'disparo_preciso',
  'preciso': 'disparo_preciso',
  'dp': 'disparo_preciso',
  'lluvia': 'lluvia_flechas',
  'flechas': 'lluvia_flechas',
  'lf': 'lluvia_flechas',
  'trampa': 'trampa_cazador',
  'cazador': 'trampa_cazador',
  'tc': 'trampa_cazador'
};

/**
 * Estados de efecto que pueden aplicarse a jugadores
 */
interface StatusEffect {
  type: 'stunned' | 'weakened' | 'defended' | 'evading' | 'enraged' | 'bleeding' | 'poisoned';
  duration: number;  // Acciones restantes
  value: number;     // Valor del efecto (ej: % de reducción)
}

/**
 * Estructura de un duelo activo - SISTEMA MEJORADO
 */
interface ActiveDuel {
  challengerJid: string;
  targetJid: string;
  challengerName: string;
  targetName: string;
  // Vida durante el duelo (MULTIPLICADA para duelos más largos)
  challengerHealth: number;
  targetHealth: number;
  challengerMaxHealth: number;
  targetMaxHealth: number;
  // Vida REAL guardada (para restaurar después del duelo)
  challengerRealHealth: number;
  targetRealHealth: number;
  // Recursos (con regeneración)
  challengerMana: number;
  targetMana: number;
  challengerMaxMana: number;
  targetMaxMana: number;
  challengerStamina: number;
  targetStamina: number;
  challengerMaxStamina: number;
  targetMaxStamina: number;
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
  // Sistema de combo mejorado
  lastAttacker: 'challenger' | 'target' | null;
  consecutiveHits: number;
  // Contador de acciones totales (para mecánicas especiales)
  totalActions: number;
  // Efectos de estado activos
  challengerEffects: StatusEffect[];
  targetEffects: StatusEffect[];
  // Apuesta y grupo
  bet: number;
  groupJid: string;
  startTime: number;
  log: string[];
  // Cooldown por jugador para evitar spam
  challengerLastAttack: number;
  targetLastAttack: number;
  // Cooldown de habilidades usadas
  challengerSkillCooldowns: Map<string, number>;
  targetSkillCooldowns: Map<string, number>;
  // Bloqueo activo (próximo ataque recibido reducido)
  challengerBlocking: boolean;
  targetBlocking: boolean;
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
 * SISTEMA MEJORADO: Usa multiplicadores PvP reducidos
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
  attackerCritBonus: number,
  defenderBlocking: boolean = false,
  comboCount: number = 0
): { damage: number; isCrit: boolean; skillUsed: string | null; wasBlocked: boolean } {

  // Daño base = ataque del jugador + daño del arma
  let baseDamage = attackerStats.attack;
  if (attackerWeapon) {
    baseDamage += attackerWeapon.attack;
  }

  // Aplicar multiplicador de habilidad (USANDO MULTIPLICADORES PVP REDUCIDOS)
  let skillUsed: string | null = null;
  if (skill && skill.effect.damageMultiplier) {
    // Usar el multiplicador PvP reducido en lugar del original
    const pvpSkillMultiplier = PVP_SKILL_MULTIPLIERS[skill.id] || skill.effect.damageMultiplier;
    baseDamage = Math.floor(baseDamage * pvpSkillMultiplier);
    skillUsed = skill.name;
  }

  // APLICAR REDUCCIÓN GENERAL DE DAÑO PVP
  baseDamage = Math.floor(baseDamage * PVP_DAMAGE_MULTIPLIER);

  // Bonus por golpes consecutivos (5% extra por cada golpe, máx 25%)
  if (isConsecutiveHit && comboCount > 0) {
    const comboBonus = Math.min(0.25, comboCount * 0.05);
    baseDamage = Math.floor(baseDamage * (1 + comboBonus));
  }

  // Aplicar bonus PvP del atacante (reducido a la mitad en duelos)
  const pvpMultiplier = 1 + (attackerPvpBonus / 200); // Dividido entre 2
  baseDamage = Math.floor(baseDamage * pvpMultiplier);

  // Calcular defensa total = defensa del jugador + defensa de armadura
  let totalDefense = defenderStats.defense;
  if (defenderArmor) {
    totalDefense += defenderArmor.defense;
  }

  // Aplicar bonus de defensa PvP del defensor
  totalDefense = Math.floor(totalDefense * (1 + defenderPvpDefense / 100));

  // Reducción de daño (50% de la defensa en PvP - más efectiva)
  const reduction = totalDefense * 0.5;
  let damage = Math.max(1, Math.floor(baseDamage - reduction));

  // Varianza pequeña (±8%)
  const variance = randomInt(-8, 8) / 100;
  damage = Math.floor(damage * (1 + variance));

  // Verificar bloqueo
  let wasBlocked = false;
  if (defenderBlocking) {
    // Bloqueo reduce 50% del daño
    damage = Math.floor(damage * 0.5);
    wasBlocked = true;
  }

  // Crítico (probabilidad reducida en PvP)
  const totalCritChance = Math.floor((attackerStats.critChance + attackerCritBonus) * 0.7); // 30% menos prob
  const isCrit = randomInt(1, 100) <= totalCritChance;
  if (isCrit) {
    damage = Math.floor(damage * 1.5); // Crítico reducido de 1.75 a 1.5
  }

  // Daño mínimo garantizado
  return { damage: Math.max(3, damage), isCrit, skillUsed, wasBlocked };
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
 * Obtiene los alias para una habilidad específica
 */
function getSkillAliases(skillId: string): string[] {
  const aliases: string[] = [];
  for (const [alias, id] of Object.entries(SKILL_ALIASES)) {
    if (id === skillId && alias.length <= 4) { // Solo alias cortos
      aliases.push(alias);
    }
  }
  return aliases.slice(0, 2); // Máximo 2 alias
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
    const aliases = getSkillAliases(skill.id);
    const aliasText = aliases.length > 0 ? ` (${aliases.join('/')})` : '';

    if (isOnCooldown) {
      const remaining = Math.ceil((cooldownEnd - now) / 1000);
      result += `   ${skill.emoji} ~${skill.name}~${aliasText} ⏳${remaining}s\n`;
    } else if (!hasResources) {
      result += `   ${skill.emoji} ~${skill.name}~${aliasText} ❌\n`;
    } else {
      result += `   ${skill.emoji} *${skill.name}*${aliasText} ✅\n`;
    }
  }

  return result;
}

/**
 * Genera el mensaje del estado del duelo
 * MEJORADO: Muestra estado de bloqueo y barras de vida
 */
function generateDuelStatusMessage(duel: ActiveDuel): string {
  const now = Date.now();
  const challengerWeapon = duel.challengerWeapon ? ITEMS[duel.challengerWeapon] : null;
  const targetWeapon = duel.targetWeapon ? ITEMS[duel.targetWeapon] : null;

  // Calcular barras de vida visual (limitar entre 0 y 10 para evitar valores negativos en repeat)
  const chHpPct = Math.min(10, Math.max(0, Math.floor((duel.challengerHealth / duel.challengerMaxHealth) * 10)));
  const tgHpPct = Math.min(10, Math.max(0, Math.floor((duel.targetHealth / duel.targetMaxHealth) * 10)));
  const chHpBar = '█'.repeat(chHpPct) + '░'.repeat(10 - chHpPct);
  const tgHpBar = '█'.repeat(tgHpPct) + '░'.repeat(10 - tgHpPct);

  let msg = `⚔️ *DUELO ESTRATÉGICO*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Jugador 1
  msg += `🗡️ *${duel.challengerName}*`;
  if (duel.challengerBlocking) msg += ` 🛡️`;
  msg += `\n`;
  msg += `   [${chHpBar}] ${duel.challengerHealth}/${duel.challengerMaxHealth}\n`;
  msg += `   💙 ${duel.challengerMana}/${duel.challengerMaxMana} | ⚡ ${duel.challengerStamina}/${duel.challengerMaxStamina}\n`;
  if (challengerWeapon) {
    msg += `   ${challengerWeapon.emoji} ${challengerWeapon.name}\n`;
  }
  msg += formatPlayerSkills(
    duel.challengerClass,
    duel.challengerMana,
    duel.challengerStamina,
    duel.challengerSkillCooldowns,
    now
  );

  msg += '\n';

  // Jugador 2
  msg += `🛡️ *${duel.targetName}*`;
  if (duel.targetBlocking) msg += ` 🛡️`;
  msg += `\n`;
  msg += `   [${tgHpBar}] ${duel.targetHealth}/${duel.targetMaxHealth}\n`;
  msg += `   💙 ${duel.targetMana}/${duel.targetMaxMana} | ⚡ ${duel.targetStamina}/${duel.targetMaxStamina}\n`;
  if (targetWeapon) {
    msg += `   ${targetWeapon.emoji} ${targetWeapon.name}\n`;
  }
  msg += formatPlayerSkills(
    duel.targetClass,
    duel.targetMana,
    duel.targetStamina,
    duel.targetSkillCooldowns,
    now
  );

  msg += '\n';

  // Racha actual con bonus
  if (duel.consecutiveHits > 0 && duel.lastAttacker) {
    const streakPlayer = duel.lastAttacker === 'challenger' ? duel.challengerName : duel.targetName;
    const streakBonus = Math.min(25, duel.consecutiveHits * 5);
    msg += `🔥 *Combo:* ${streakPlayer} x${duel.consecutiveHits} (+${streakBonus}%)\n\n`;
  }

  // Log de combate (últimos 4)
  if (duel.log.length > 0) {
    msg += `📜 *Acciones:*\n`;
    for (const line of duel.log.slice(-4)) {
      msg += `   ${line}\n`;
    }
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `*g*=golpe | *b*=bloquear | *poder*\n`;
  msg += `💡 _Bloquea para romper combos y ganar maná_`;

  return msg;
}

/**
 * Finaliza un duelo y guarda la vida real
 * SISTEMA MEJORADO: Convierte vida de duelo a vida real
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

  // Convertir vida de duelo a vida real (dividir por multiplicador)
  // La vida de duelo es la vida real * PVP_HEALTH_MULTIPLIER
  const challengerDuelHealth = Math.max(0, duel.challengerHealth);
  const targetDuelHealth = Math.max(0, duel.targetHealth);

  // Calcular porcentaje de vida restante en el duelo y aplicarlo a la vida real
  const challengerHealthPercent = challengerDuelHealth / duel.challengerMaxHealth;
  const targetHealthPercent = targetDuelHealth / duel.targetMaxHealth;

  // Vida real final basada en el porcentaje del duelo
  const challengerRealFinalHealth = Math.max(1, Math.floor(duel.challengerRealHealth * challengerHealthPercent));
  const targetRealFinalHealth = Math.max(1, Math.floor(duel.targetRealHealth * targetHealthPercent));

  // Calcular recompensas base (bonus por duelo largo)
  const duelDuration = Date.now() - duel.startTime;
  const durationBonus = Math.min(200, Math.floor(duelDuration / 5000) * 10); // +10 XP cada 5 segundos, máx 200
  const baseExpReward = 300 + Math.floor(loser.level * 15) + durationBonus;
  let expReward = baseExpReward + randomInt(0, 150);

  // Aplicar multiplicadores de modos globales
  const modeMessages: string[] = [];

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

  // GUARDAR VIDA REAL DEL GANADOR (convertida desde vida de duelo)
  const winnerRealFinalHealth = winnerJid === duel.challengerJid
    ? challengerRealFinalHealth
    : targetRealFinalHealth;

  db.updateUser(winnerJid, {
    exp: winner.exp + expReward,
    money: winner.money + duel.bet,
    health: winnerRealFinalHealth,
    combatStats: winnerStats
  });

  // Actualizar stats del perdedor
  const loserStats = { ...loser.combatStats };
  loserStats.pvpLosses++;

  db.updateUser(loserJid, {
    money: Math.max(0, loser.money - duel.bet),
    health: 1, // Revive con 1 HP
    combatStats: loserStats
  });

  // Aplicar cuota del IMSS al perdedor (murió en el duelo)
  const freshLoser = db.getUser(loserJid);
  const imssResult = applyDeathPenalty(db, loserJid, freshLoser);

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

  resultMsg += `\n❤️ *Salud final (real):*\n`;
  resultMsg += `   ${duel.challengerName}: *${challengerRealFinalHealth}* HP\n`;
  resultMsg += `   ${duel.targetName}: *${targetRealFinalHealth}* HP\n`;

  // Mostrar cuota del IMSS al perdedor
  resultMsg += generateIMSSMessage(imssResult, loserName);

  resultMsg += `\n\n💡 _Usa pociones para recuperar vida_`;

  await ctx.m.reply(resultMsg);
}

/**
 * Genera el mensaje de ayuda completo del sistema de duelos
 */
function generateDuelHelpMessage(): string {
  let msg = `⚔️ *GUÍA DE DUELOS PVP*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📋 *CÓMO INICIAR UN DUELO*\n`;
  msg += `• */duelo @usuario* - Reta a alguien\n`;
  msg += `• */duelo @usuario 1000* - Con apuesta\n`;
  msg += `• El retado usa */aceptar* o */rechazar*\n\n`;

  msg += `🎮 *COMANDOS EN COMBATE*\n`;
  msg += `• *g* - Golpe básico (5⚡)\n`;
  msg += `• *b* - Bloquear (3⚡, +8💙)\n`;
  msg += `• *dp* - Disparo preciso (arquero)\n`;
  msg += `• *bf* - Bola de fuego (mago)\n`;
  msg += `• *gb* - Golpe brutal (guerrero)\n`;
  msg += `• *af* - Ataque furtivo (ladrón)\n`;
  msg += `• */rendirse* - Abandonar duelo\n\n`;

  msg += `⚡ *SISTEMA DE COMBATE*\n`;
  msg += `• Sin turnos: ¡el más rápido ataca!\n`;
  msg += `• Cooldown: 1.5s entre acciones\n`;
  msg += `• Vida x2.5 para duelos más largos\n`;
  msg += `• Daño reducido vs PvE\n\n`;

  msg += `🔥 *SISTEMA DE COMBOS*\n`;
  msg += `• 3+ golpes seguidos = bonus daño\n`;
  msg += `• +5% por golpe (máx +25%)\n`;
  msg += `• ¡Bloquear rompe el combo enemigo!\n\n`;

  msg += `🛡️ *BLOQUEO*\n`;
  msg += `• Reduce 50% del próximo ataque\n`;
  msg += `• Regenera +8 maná\n`;
  msg += `• Rompe el combo del oponente\n`;
  msg += `• Se usa automáticamente al recibir golpe\n\n`;

  msg += `💚 *REGENERACIÓN*\n`;
  msg += `• Al atacar: +5💙 maná\n`;
  msg += `• Al bloquear: +8💙 maná\n`;
  msg += `• Al usar habilidad: +3⚡ stamina\n\n`;

  msg += `🏆 *RECOMPENSAS*\n`;
  msg += `• XP base + bonus por nivel del rival\n`;
  msg += `• +10 XP cada 5s de duelo (máx +200)\n`;
  msg += `• Ganas la apuesta si la hay\n`;
  msg += `• El perdedor paga cuota IMSS\n\n`;

  msg += `💡 *TIPS ESTRATÉGICOS*\n`;
  msg += `• Bloquea cuando el enemigo tenga combo\n`;
  msg += `• Alterna entre ataque y defensa\n`;
  msg += `• Guarda maná para habilidades clave\n`;
  msg += `• Usa robo vital para recuperar vida\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📝 */duelo @usuario* para empezar!`;

  return msg;
}

/**
 * Plugin: Duelo - Desafiar a otro jugador
 */
export const dueloPlugin: PluginHandler = {
  command: ['duelo', 'duel', 'pvp', 'retar'],
  tags: ['rpg'],
  help: [
    'duelo @usuario [apuesta] - Desafía a un jugador',
    'duelo -help - Muestra guía completa de duelos',
    'Sistema estratégico con bloqueo y combos'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const challenger = db.getUser(m.sender);
    const groupJid = m.chat;

    // Verificar si piden ayuda
    if (args.length > 0 && ['-help', 'help', '-h', 'ayuda', '-ayuda', '?'].includes(args[0].toLowerCase())) {
      await m.reply(generateDuelHelpMessage());
      return;
    }

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
    if (challenger.health < PVP.MIN_HEALTH_DUEL) {
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
        `💰 La apuesta es opcional (mín. 100, máx. 50000)\n\n` +
        `💡 Usa */duelo -help* para ver la guía completa`
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

    if (target.health < PVP.MIN_HEALTH_DUEL) {
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
    if (accepter.health < PVP.MIN_HEALTH_DUEL) {
      await m.reply(`${EMOJI.error} Estás muy herido. Cúrate primero.`);
      return;
    }

    if (challenger.health < PVP.MIN_HEALTH_DUEL) {
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

    // Calcular vida de duelo (multiplicada para combates más largos)
    // Usar maxHealth de calculateTotalStats que incluye clase y equipamiento
    const challengerDuelHealth = Math.floor(challenger.health * PVP_HEALTH_MULTIPLIER);
    const challengerDuelMaxHealth = Math.floor(challengerStats.maxHealth * PVP_HEALTH_MULTIPLIER);
    const targetDuelHealth = Math.floor(accepter.health * PVP_HEALTH_MULTIPLIER);
    const targetDuelMaxHealth = Math.floor(accepterStats.maxHealth * PVP_HEALTH_MULTIPLIER);

    // Crear duelo activo con SISTEMA MEJORADO
    const newDuel: ActiveDuel = {
      challengerJid,
      targetJid: m.sender,
      challengerName: challenger.name,
      targetName: accepter.name,
      // Vida de duelo (multiplicada)
      challengerHealth: challengerDuelHealth,
      targetHealth: targetDuelHealth,
      challengerMaxHealth: challengerDuelMaxHealth,
      targetMaxHealth: targetDuelMaxHealth,
      // Vida real guardada
      challengerRealHealth: challenger.health,
      targetRealHealth: accepter.health,
      // Recursos con máximos
      challengerMana: challenger.mana,
      targetMana: accepter.mana,
      challengerMaxMana: challenger.maxMana,
      targetMaxMana: accepter.maxMana,
      challengerStamina: challenger.stamina,
      targetStamina: accepter.stamina,
      challengerMaxStamina: challenger.maxStamina,
      targetMaxStamina: accepter.maxStamina,
      // Stats
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
      // Sistema de combo
      lastAttacker: null,
      consecutiveHits: 0,
      totalActions: 0,
      // Efectos de estado
      challengerEffects: [],
      targetEffects: [],
      // Apuesta y grupo
      bet: duelInfo.bet,
      groupJid,
      startTime: now,
      log: [],
      // Cooldowns
      challengerLastAttack: 0,
      targetLastAttack: 0,
      challengerSkillCooldowns: new Map(),
      targetSkillCooldowns: new Map(),
      // Bloqueo
      challengerBlocking: false,
      targetBlocking: false
    };

    activeDuels.set(groupJid, newDuel);

    // Mensaje de inicio mejorado
    let startMsg = `⚔️ *¡DUELO INICIADO!*\n`;
    startMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    startMsg += `🗡️ *${challenger.name}* VS 🛡️ *${accepter.name}*\n\n`;
    startMsg += `⚡ *¡COMBATE ESTRATÉGICO!*\n`;
    startMsg += `   • *g* - Golpe básico\n`;
    startMsg += `   • *b* - Bloquear (reduce 50% daño)\n`;
    startMsg += `   • Nombre/alias de habilidad\n`;
    startMsg += `   • Combo de 3+ golpes = bonus\n\n`;
    startMsg += `💡 _¡Usa tus recursos sabiamente!_\n\n`;

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

    // Verificar si el defensor está bloqueando
    const defenderBlocking = isChallenger ? duel.targetBlocking : duel.challengerBlocking;

    // Verificar racha
    const currentAttacker = isChallenger ? 'challenger' : 'target';
    const isConsecutive = duel.lastAttacker === currentAttacker;

    // Calcular daño real (con nuevos parámetros PvP)
    const result = calculateRealDamage(
      { attack: attackerStats.attack, critChance: attackerStats.critChance },
      { defense: defenderStats.defense },
      attackerWeapon,
      defenderArmor,
      null,
      isConsecutive && duel.consecutiveHits >= 2,
      attackerRankBenefits.pvpDamageBonus,
      defenderRankBenefits.pvpDefenseBonus,
      attackerRankBenefits.critBonus,
      defenderBlocking,
      duel.consecutiveHits
    );

    // Resetear bloqueo del defensor (se usa una vez)
    if (isChallenger) {
      duel.targetBlocking = false;
    } else {
      duel.challengerBlocking = false;
    }

    // Aplicar daño y consumir stamina
    if (isChallenger) {
      duel.targetHealth = Math.max(0, duel.targetHealth - result.damage);
      duel.challengerStamina = Math.max(0, duel.challengerStamina - 5);
      // Regenerar recursos del atacante
      duel.challengerMana = Math.min(duel.challengerMaxMana, duel.challengerMana + REGEN_PER_ACTION.mana);
    } else {
      duel.challengerHealth = Math.max(0, duel.challengerHealth - result.damage);
      duel.targetStamina = Math.max(0, duel.targetStamina - 5);
      // Regenerar recursos del atacante
      duel.targetMana = Math.min(duel.targetMaxMana, duel.targetMana + REGEN_PER_ACTION.mana);
    }

    // Actualizar racha
    if (duel.lastAttacker === currentAttacker) {
      duel.consecutiveHits++;
    } else {
      duel.lastAttacker = currentAttacker;
      duel.consecutiveHits = 1;
    }

    // Incrementar contador de acciones
    duel.totalActions++;

    // Obtener nombre del arma para el log
    const weaponName = attackerWeaponId ? ITEMS[attackerWeaponId]?.name : 'puños';
    const weaponEmoji = attackerWeaponId ? ITEMS[attackerWeaponId]?.emoji : '👊';

    // Agregar al log
    let logEntry = `${weaponEmoji} *${attackerName}* ataca`;
    if (result.wasBlocked) {
      logEntry += ` 🛡️BLOQUEADO`;
    }
    if (result.isCrit) {
      logEntry += ` 💥CRIT`;
    }
    if (duel.consecutiveHits >= 3) {
      logEntry += ` 🔥x${duel.consecutiveHits}`;
    }
    logEntry += ` → *${result.damage}*`;
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
 * Plugin: Bloquear en duelo - Prepara defensa para el próximo ataque
 */
export const bloquearDueloPlugin: PluginHandler = {
  command: ['bloquear', 'block', 'defender', 'b'],
  tags: ['rpg'],
  help: ['bloquear - Bloquea el próximo ataque (reduce 50% daño) (alias: b)'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupJid = m.chat;

    const duel = activeDuels.get(groupJid);
    if (!duel) return;

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
      await m.reply(`⏳ Espera ${remaining}s.`);
      return;
    }

    // Verificar stamina para bloquear
    const currentStamina = isChallenger ? duel.challengerStamina : duel.targetStamina;
    if (currentStamina < 3) {
      await m.reply(`${EMOJI.error} ¡Sin energía! Necesitas 3 ⚡ para bloquear.`);
      return;
    }

    // Verificar si ya está bloqueando
    const alreadyBlocking = isChallenger ? duel.challengerBlocking : duel.targetBlocking;
    if (alreadyBlocking) {
      await m.reply(`${EMOJI.warning} Ya estás en posición de bloqueo.`);
      return;
    }

    // Actualizar tiempo de acción y activar bloqueo
    if (isChallenger) {
      duel.challengerLastAttack = now;
      duel.challengerBlocking = true;
      duel.challengerStamina = Math.max(0, duel.challengerStamina - 3);
      // Regenerar maná al defender
      duel.challengerMana = Math.min(duel.challengerMaxMana, duel.challengerMana + REGEN_PER_ACTION.mana + 3);
    } else {
      duel.targetLastAttack = now;
      duel.targetBlocking = true;
      duel.targetStamina = Math.max(0, duel.targetStamina - 3);
      // Regenerar maná al defender
      duel.targetMana = Math.min(duel.targetMaxMana, duel.targetMana + REGEN_PER_ACTION.mana + 3);
    }

    // Romper la racha del oponente
    if (duel.lastAttacker && duel.lastAttacker !== (isChallenger ? 'challenger' : 'target')) {
      duel.consecutiveHits = 0;
    }

    // Incrementar contador de acciones
    duel.totalActions++;

    const playerName = isChallenger ? duel.challengerName : duel.targetName;
    duel.log.push(`🛡️ *${playerName}* se prepara para bloquear`);

    await m.reply(`🛡️ *${playerName}* levanta su guardia!\n_El próximo ataque será bloqueado (50% menos daño)_`);
  }
};

/**
 * Busca si el texto contiene el nombre de una habilidad
 * Ahora busca en TODAS las habilidades del juego, no solo las de clase
 */
function findSkillByText(text: string, playerClass: string | null): Skill | null {
  if (!playerClass) return null;

  const classInfo = CLASSES[playerClass as keyof typeof CLASSES];
  if (!classInfo) return null;

  // Normalizar texto de entrada
  const normalizedText = text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '') // Quitar espacios y caracteres especiales
    .trim();

  if (!normalizedText) return null;

  // 1. Primero buscar en alias
  const aliasMatch = SKILL_ALIASES[normalizedText];
  if (aliasMatch && classInfo.skills.includes(aliasMatch)) {
    return SKILLS[aliasMatch];
  }

  // 2. Buscar en las habilidades de la clase del jugador
  for (const skillId of classInfo.skills) {
    const skill = SKILLS[skillId];
    if (!skill) continue;

    // Normalizar nombre de habilidad
    const skillNameNorm = skill.name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

    const skillIdNorm = skill.id.toLowerCase().replace(/_/g, '');

    // Coincidencias múltiples
    if (
      normalizedText === skillNameNorm ||                    // Nombre exacto
      normalizedText === skillIdNorm ||                      // ID exacto
      skillNameNorm.startsWith(normalizedText) ||            // Empieza con el texto
      skillIdNorm.startsWith(normalizedText) ||              // ID empieza con el texto
      normalizedText.includes(skillNameNorm) ||              // Texto contiene el nombre
      skillNameNorm.includes(normalizedText)                 // Nombre contiene el texto
    ) {
      return skill;
    }

    // Buscar palabras individuales del nombre
    const skillWords = skill.name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/);

    for (const word of skillWords) {
      if (word.length >= 3 && (normalizedText === word || word.startsWith(normalizedText))) {
        return skill;
      }
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

  // Verificar si el defensor está bloqueando
  const defenderBlocking = isChallenger ? duel.targetBlocking : duel.challengerBlocking;

  // Verificar racha
  const currentAttacker = isChallenger ? 'challenger' : 'target';
  const isConsecutive = duel.lastAttacker === currentAttacker;

  // Calcular daño con habilidad (usando nuevos parámetros PvP)
  const result = calculateRealDamage(
    { attack: attackerStats.attack, critChance: attackerStats.critChance },
    { defense: defenderStats.defense },
    attackerWeapon,
    defenderArmor,
    skill,
    isConsecutive && duel.consecutiveHits >= 2,
    attackerRankBenefits.pvpDamageBonus,
    defenderRankBenefits.pvpDefenseBonus,
    attackerRankBenefits.critBonus,
    defenderBlocking,
    duel.consecutiveHits
  );

  // Resetear bloqueo del defensor
  if (isChallenger) {
    duel.targetBlocking = false;
  } else {
    duel.challengerBlocking = false;
  }

  // Aplicar cooldown de habilidad
  const skillCooldownTime = (skill.cooldown || 2) * 3000;
  skillCooldowns.set(skill.id, now + skillCooldownTime);

  // Aplicar daño y consumir recursos
  if (isChallenger) {
    duel.targetHealth = Math.max(0, duel.targetHealth - result.damage);
    duel.challengerMana -= skill.manaCost;
    duel.challengerStamina -= skill.staminaCost;
    // Regenerar un poco de stamina después de usar habilidad
    duel.challengerStamina = Math.min(duel.challengerMaxStamina, duel.challengerStamina + REGEN_PER_ACTION.stamina);
  } else {
    duel.challengerHealth = Math.max(0, duel.challengerHealth - result.damage);
    duel.targetMana -= skill.manaCost;
    duel.targetStamina -= skill.staminaCost;
    // Regenerar un poco de stamina después de usar habilidad
    duel.targetStamina = Math.min(duel.targetMaxStamina, duel.targetStamina + REGEN_PER_ACTION.stamina);
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

  // Incrementar contador de acciones
  duel.totalActions++;

  // Agregar al log
  let logEntry = `${skill.emoji} *${attackerName}* → *${skill.name}*`;
  if (result.wasBlocked) {
    logEntry += ` 🛡️`;
  }
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
 * Genera un regex dinámico que captura todas las habilidades y alias
 */
function generateSkillRegex(): RegExp {
  const allPatterns: string[] = [];

  // Agregar todos los alias
  for (const alias of Object.keys(SKILL_ALIASES)) {
    allPatterns.push(alias);
  }

  // Agregar todos los nombres de habilidades
  for (const skill of Object.values(SKILLS)) {
    // ID sin guiones bajos
    allPatterns.push(skill.id.replace(/_/g, ''));
    // ID con guiones como espacios opcionales
    allPatterns.push(skill.id.replace(/_/g, '.?'));
    // Nombre normalizado
    const nameNorm = skill.name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '.?');
    allPatterns.push(nameNorm);
    // Palabras individuales del nombre (mínimo 4 letras para evitar falsos positivos)
    const words = skill.name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 4);
    allPatterns.push(...words);
  }

  // Eliminar duplicados y ordenar por longitud (más largos primero)
  const uniquePatterns = [...new Set(allPatterns)]
    .filter(p => p.length >= 2)
    .sort((a, b) => b.length - a.length);

  return new RegExp(`^(${uniquePatterns.join('|')})$`, 'i');
}

// Regex generado dinámicamente con todas las habilidades
const SKILL_REGEX = generateSkillRegex();

/**
 * Plugin: Detectar habilidades por nombre directo (sin comando)
 * Detecta cuando alguien escribe el nombre de una habilidad durante un duelo
 * Ahora usa un regex generado dinámicamente con TODAS las habilidades
 */
export const skillDetectorPlugin: PluginHandler = {
  command: SKILL_REGEX,
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

    // Usar la función executeSkill que ya maneja todo correctamente
    await executeSkill(ctx, duel, skill, isChallenger);
    return;
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
