/**
 * Plugin de Dungeons Interactivos - RPG
 * Sistema de combate por turnos con decisiones del jugador
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom, matchesIgnoreAccents } from '../lib/utils.js';
import { DUNGEONS, MONSTERS, ITEMS, CLASSES, SKILLS, type Dungeon, type Monster, type Skill } from '../types/rpg.js';
import { calculateTotalStats, type UserRPG } from '../types/user.js';
import { updateQuestProgress } from './rpg-misiones.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';
import { applyDeathPenalty, generateIMSSMessage } from './rpg-bombardear.js';
import { PVP } from '../constants/rpg.js';

// ==================== CONFIGURACIÓN ====================

const DUNGEON_COOLDOWN = PVP.DUNGEON_COOLDOWN;
const ACTION_TIMEOUT = 60000; // 60 segundos para actuar
const DEFEND_DAMAGE_REDUCTION = 0.5; // 50% menos daño al defender
const DEFEND_MANA_REGEN = 5; // Regenera maná al defender
const FLEE_BASE_CHANCE = 0.4; // 40% base de huir
const FLEE_BOSS_PENALTY = 0.25; // -25% chance contra boss

// ==================== TIPOS ====================

interface DungeonSession {
  jid: string;
  groupJid: string;
  dungeon: Dungeon;
  playerName: string;
  // Stats del jugador
  playerStats: ReturnType<typeof calculateTotalStats>;
  playerClass: string | null;
  playerLevel: number;
  // Recursos actuales
  currentHealth: number;
  maxHealth: number;
  currentMana: number;
  maxMana: number;
  currentStamina: number;
  maxStamina: number;
  // Estado del dungeon
  currentEncounterIndex: number;
  isBossFight: boolean;
  // Monstruo actual
  currentMonster: Monster | null;
  monsterHealth: number;
  monsterMaxHealth: number;
  monsterIsEnhanced: boolean; // Para bosses
  // Sistema de turnos
  isPlayerTurn: boolean;
  playerDefending: boolean;
  // Buffs activos
  playerAttackBuff: number;
  playerDefenseBuff: number;
  buffDuration: number;
  // Recompensas acumuladas
  monstersKilled: number;
  totalDamageDealt: number;
  expGained: number;
  moneyGained: number;
  itemsGained: string[];
  // Log de combate
  combatLog: string[];
  // Timestamps
  startTime: number;
  lastActionTime: number;
  actionTimeout: NodeJS.Timeout | null;
  // Cooldowns de habilidades (skill.id -> turno cuando termina)
  skillCooldowns: Map<string, number>;
  currentTurn: number;
}

// Sesiones activas de dungeons
const activeDungeons = new Map<string, DungeonSession>();

// Tiempo máximo de inactividad antes de limpiar sesión (10 minutos)
const SESSION_INACTIVITY_TIMEOUT = 10 * 60 * 1000;

/**
 * Limpia sesiones inactivas (más de 10 minutos sin actividad)
 */
function cleanupInactiveSessions() {
  const now = Date.now();
  for (const [jid, session] of activeDungeons.entries()) {
    if (now - session.lastActionTime > SESSION_INACTIVITY_TIMEOUT) {
      if (session.actionTimeout) clearTimeout(session.actionTimeout);
      activeDungeons.delete(jid);
    }
  }
}

// Limpiar sesiones inactivas cada 5 minutos
setInterval(cleanupInactiveSessions, 5 * 60 * 1000);

// ==================== UTILIDADES ====================

/**
 * Calcula el daño en combate
 */
function calculateDamage(
  attack: number,
  defense: number,
  critChance: number,
  damageMultiplier: number = 1
): { damage: number; isCrit: boolean } {
  const baseDamage = Math.max(1, attack - defense * 0.5);
  const variance = randomInt(-10, 10) / 100;
  let damage = Math.floor(baseDamage * (1 + variance) * damageMultiplier);

  const isCrit = randomInt(1, 100) <= critChance;
  if (isCrit) damage = Math.floor(damage * 1.5);

  return { damage: Math.max(1, damage), isCrit };
}

/**
 * Obtiene las habilidades disponibles del jugador
 */
function getAvailableSkills(session: DungeonSession): Skill[] {
  if (!session.playerClass) return [];

  const classInfo = CLASSES[session.playerClass as keyof typeof CLASSES];
  if (!classInfo) return [];

  return classInfo.skills
    .map(id => SKILLS[id])
    .filter(s => {
      if (!s) return false;
      // Verificar recursos
      if (session.currentMana < s.manaCost) return false;
      if (session.currentStamina < s.staminaCost) return false;
      // Verificar cooldown
      const cooldownEnd = session.skillCooldowns.get(s.id) || 0;
      if (session.currentTurn < cooldownEnd) return false;
      return true;
    });
}

/**
 * Genera el mensaje del estado actual del combate
 */
function generateCombatStatus(session: DungeonSession): string {
  const monster = session.currentMonster!;
  const dungeon = session.dungeon;

  // Barras de vida
  const playerHpPct = Math.max(0, Math.floor((session.currentHealth / session.maxHealth) * 10));
  const monsterHpPct = Math.max(0, Math.floor((session.monsterHealth / session.monsterMaxHealth) * 10));
  const playerHpBar = '█'.repeat(playerHpPct) + '░'.repeat(10 - playerHpPct);
  const monsterHpBar = '█'.repeat(monsterHpPct) + '░'.repeat(10 - monsterHpPct);

  let msg = `${dungeon.emoji} *${dungeon.name.toUpperCase()}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Encuentro actual
  const encounterNum = session.isBossFight
    ? '👹 BOSS FINAL'
    : `⚔️ Encuentro ${session.currentEncounterIndex + 1}/${dungeon.monsters.length}`;
  msg += `${encounterNum} | 🔄 Turno ${session.currentTurn}\n\n`;

  // Monstruo
  msg += `${monster.emoji} *${monster.name}* ${session.monsterIsEnhanced ? '👑' : ''}\n`;
  msg += `   Nv.${monster.level} | [${monsterHpBar}]\n`;
  msg += `   ❤️ ${session.monsterHealth}/${session.monsterMaxHealth}\n\n`;

  // Jugador
  msg += `🧙 *${session.playerName}*${session.playerDefending ? ' 🛡️' : ''}\n`;
  msg += `   [${playerHpBar}] ❤️ ${session.currentHealth}/${session.maxHealth}\n`;
  msg += `   💙 ${session.currentMana}/${session.maxMana} | ⚡ ${session.currentStamina}/${session.maxStamina}\n`;

  // Buffs activos
  if (session.buffDuration > 0) {
    const buffs: string[] = [];
    if (session.playerAttackBuff > 0) buffs.push(`⚔️+${session.playerAttackBuff}%`);
    if (session.playerDefenseBuff > 0) buffs.push(`🛡️+${session.playerDefenseBuff}%`);
    if (buffs.length > 0) {
      msg += `   ✨ ${buffs.join(' ')} (${session.buffDuration} turnos)\n`;
    }
  }
  msg += '\n';

  // Log de combate (últimas 3 acciones)
  if (session.combatLog.length > 0) {
    msg += `📜 *Combate:*\n`;
    for (const line of session.combatLog.slice(-3)) {
      msg += `   ${line}\n`;
    }
    msg += '\n';
  }

  // Acciones disponibles
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📝 *Acciones:*\n`;
  msg += `   ⚔️ *a* - Atacar\n`;
  msg += `   🛡️ *d* - Defender (+💙, -50% daño)\n`;
  msg += `   🎒 *i* - Usar item/poción\n`;

  // Habilidades de clase
  const skills = getAvailableSkills(session);
  if (skills.length > 0) {
    msg += `   ✨ *h* - Usar habilidad\n`;
  }

  // Huir (no disponible contra boss)
  if (!session.isBossFight) {
    msg += `   🏃 *huir* - Escapar del dungeon\n`;
  }

  msg += `\n⏰ _Tienes 60 segundos para actuar_`;

  return msg;
}

/**
 * Genera el menú de habilidades
 */
function generateSkillsMenu(session: DungeonSession): string {
  const classInfo = session.playerClass ? CLASSES[session.playerClass as keyof typeof CLASSES] : null;

  let msg = `✨ *HABILIDADES*${classInfo ? ` (${classInfo.emoji} ${classInfo.name})` : ''}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Verificar si tiene clase
  if (!session.playerClass || !classInfo) {
    msg += `❌ No tienes una clase asignada.\n\n`;
    msg += `💡 Usa */clases* para ver las clases disponibles\n`;
    msg += `💡 Usa */clase [nombre]* para elegir una clase`;
    return msg;
  }

  const skills = getAvailableSkills(session);

  if (skills.length === 0) {
    msg += `❌ No tienes habilidades disponibles.\n`;
    msg += `_Falta maná, energía o están en cooldown._\n\n`;
    msg += `💡 Usa *d* para defender y regenerar maná.`;
    return msg;
  }

  msg += `💙 Maná: ${session.currentMana}/${session.maxMana}\n`;
  msg += `⚡ Energía: ${session.currentStamina}/${session.maxStamina}\n\n`;

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const cooldownEnd = session.skillCooldowns.get(skill.id) || 0;
    const onCooldown = session.currentTurn < cooldownEnd;
    const cdText = onCooldown ? ` ⏳${cooldownEnd - session.currentTurn}t` : '';

    msg += `*${i + 1}.* ${skill.emoji} *${skill.name}*${cdText}\n`;
    msg += `   ${skill.description}\n`;
    msg += `   💙${skill.manaCost} ⚡${skill.staminaCost}`;
    if (skill.cooldown > 0) msg += ` | CD: ${skill.cooldown}t`;
    msg += '\n\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📝 Usa *h1*, *h2*, etc. o escribe el nombre`;

  return msg;
}

/**
 * Genera el menú de items consumibles
 */
function generateItemsMenu(session: DungeonSession, user: UserRPG): string {
  let msg = `🎒 *INVENTARIO - CONSUMIBLES*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Filtrar solo consumibles del inventario
  const consumables = user.inventory.filter(inv => {
    const item = ITEMS[inv.itemId];
    return item && item.type === 'consumable' && item.consumeEffect &&
           (item.consumeEffect.health || item.consumeEffect.mana || item.consumeEffect.stamina);
  });

  if (consumables.length === 0) {
    msg += `❌ No tienes items consumibles.\n\n`;
    msg += `💡 Compra pociones en la tienda con */tienda*`;
    return msg;
  }

  msg += `❤️ Salud: ${session.currentHealth}/${session.maxHealth}\n`;
  msg += `💙 Maná: ${session.currentMana}/${session.maxMana}\n`;
  msg += `⚡ Energía: ${session.currentStamina}/${session.maxStamina}\n\n`;

  for (let i = 0; i < consumables.length; i++) {
    const inv = consumables[i];
    const item = ITEMS[inv.itemId];
    if (!item) continue;

    const effects: string[] = [];
    if (item.consumeEffect?.health) effects.push(`+${item.consumeEffect.health} ❤️`);
    if (item.consumeEffect?.mana) effects.push(`+${item.consumeEffect.mana} 💙`);
    if (item.consumeEffect?.stamina) effects.push(`+${item.consumeEffect.stamina} ⚡`);

    msg += `*${i + 1}.* ${item.emoji} *${item.name}* x${inv.quantity}\n`;
    msg += `   ${effects.join(' | ')}\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📝 Usa *i1*, *i2*, etc. o escribe el nombre`;

  return msg;
}

/**
 * Limpia una sesión de dungeon
 */
function cleanupDungeonSession(jid: string) {
  const session = activeDungeons.get(jid);
  if (session) {
    if (session.actionTimeout) clearTimeout(session.actionTimeout);
    activeDungeons.delete(jid);
  }
}

/**
 * Inicia el timeout de acción
 */
function startActionTimeout(session: DungeonSession, ctx: MessageContext) {
  if (session.actionTimeout) clearTimeout(session.actionTimeout);

  session.actionTimeout = setTimeout(async () => {
    const currentSession = activeDungeons.get(session.jid);
    if (!currentSession || currentSession.startTime !== session.startTime) return;

    // Timeout - el monstruo ataca
    await ctx.m.reply(`⏰ *¡Tiempo agotado!* El monstruo aprovecha tu distracción...`);
    await processMonsterTurn(currentSession, ctx);
  }, ACTION_TIMEOUT);
}

/**
 * Procesa el turno del monstruo
 */
async function processMonsterTurn(session: DungeonSession, ctx: MessageContext) {
  const { m } = ctx;
  const monster = session.currentMonster!;

  // Calcular daño del monstruo
  let monsterAttack = monster.attack;
  if (session.monsterIsEnhanced) {
    monsterAttack = Math.floor(monsterAttack * 1.2);
  }

  let playerDefense = session.playerStats.defense;
  // Aplicar buff de defensa
  if (session.buffDuration > 0 && session.playerDefenseBuff > 0) {
    playerDefense = Math.floor(playerDefense * (1 + session.playerDefenseBuff / 100));
  }

  const result = calculateDamage(monsterAttack, playerDefense, 5);
  let finalDamage = result.damage;

  // Reducir daño si está defendiendo
  const wasDefending = session.playerDefending;
  if (wasDefending) {
    finalDamage = Math.floor(finalDamage * DEFEND_DAMAGE_REDUCTION);
    session.playerDefending = false;
  }

  session.currentHealth = Math.max(0, session.currentHealth - finalDamage);

  // Log del ataque
  let attackLog = `${monster.emoji} ${monster.name} ataca → *${finalDamage}*`;
  if (result.isCrit) attackLog += ' 💥CRIT';
  if (wasDefending) attackLog += ' 🛡️';
  session.combatLog.push(attackLog);

  // Verificar muerte del jugador
  if (session.currentHealth <= 0) {
    await endDungeon(session, ctx, false, 'death');
    return;
  }

  // Reducir duración de buffs
  if (session.buffDuration > 0) {
    session.buffDuration--;
    if (session.buffDuration <= 0) {
      session.playerAttackBuff = 0;
      session.playerDefenseBuff = 0;
    }
  }

  // Turno del jugador
  session.isPlayerTurn = true;
  session.currentTurn++;
  session.lastActionTime = Date.now();

  // Mostrar estado y reiniciar timeout
  const statusMsg = generateCombatStatus(session);
  await m.reply(statusMsg);
  startActionTimeout(session, ctx);
}

/**
 * Procesa la muerte del monstruo actual
 */
async function processMonsterDeath(session: DungeonSession, ctx: MessageContext) {
  const { m } = ctx;
  const monster = session.currentMonster!;
  const dungeon = session.dungeon;

  // Recompensas del monstruo
  let expReward = monster.expReward;
  let moneyReward = randomInt(monster.moneyReward[0], monster.moneyReward[1]);

  // Bonus por boss
  if (session.isBossFight) {
    expReward *= 2;
    moneyReward *= 2;
  }

  session.expGained += expReward;
  session.moneyGained += moneyReward;
  session.monstersKilled++;

  // Drops
  const dropChanceMultiplier = session.isBossFight ? 1 : 0.5;
  for (const drop of monster.drops) {
    if (Math.random() <= drop.chance * dropChanceMultiplier) {
      session.itemsGained.push(drop.itemId);
    }
  }

  // Log de victoria
  const dropItems = session.itemsGained.slice(-monster.drops.length)
    .map(id => ITEMS[id]?.name || id)
    .filter(Boolean);

  let victoryLog = `✅ *${monster.name}* derrotado!`;
  session.combatLog.push(victoryLog);

  // Verificar si era el boss
  if (session.isBossFight) {
    // Dungeon completado
    await endDungeon(session, ctx, true, 'victory');
    return;
  }

  // Siguiente encuentro o boss
  session.currentEncounterIndex++;

  if (session.currentEncounterIndex >= dungeon.monsters.length) {
    // Toca el boss
    await startBossFight(session, ctx);
  } else {
    // Siguiente monstruo normal
    await startNextEncounter(session, ctx);
  }
}

/**
 * Inicia el siguiente encuentro normal
 */
async function startNextEncounter(session: DungeonSession, ctx: MessageContext) {
  const { m } = ctx;
  const dungeon = session.dungeon;

  const monsterId = dungeon.monsters[session.currentEncounterIndex];
  const monster = MONSTERS[monsterId];

  if (!monster) {
    await endDungeon(session, ctx, false, 'error');
    return;
  }

  session.currentMonster = monster;
  session.monsterHealth = monster.health;
  session.monsterMaxHealth = monster.health;
  session.monsterIsEnhanced = false;
  session.isPlayerTurn = true;
  session.playerDefending = false;
  session.combatLog = [];
  session.lastActionTime = Date.now();

  // Regenerar un poco de recursos entre encuentros
  session.currentMana = Math.min(session.maxMana, session.currentMana + 5);
  session.currentStamina = Math.min(session.maxStamina, session.currentStamina + 10);

  let msg = `\n🚪 *Avanzas más profundo...*\n\n`;
  msg += `⚔️ *¡Nuevo encuentro!*\n`;
  msg += `${monster.emoji} *${monster.name}* (Nv.${monster.level}) aparece!\n\n`;

  await m.reply(msg);

  // Mostrar estado de combate
  const statusMsg = generateCombatStatus(session);
  await m.reply(statusMsg);
  startActionTimeout(session, ctx);
}

/**
 * Inicia la pelea contra el boss
 */
async function startBossFight(session: DungeonSession, ctx: MessageContext) {
  const { m } = ctx;
  const dungeon = session.dungeon;

  const boss = MONSTERS[dungeon.bossId];
  if (!boss) {
    await endDungeon(session, ctx, false, 'error');
    return;
  }

  // Stats mejorados del boss
  const enhancedHealth = Math.floor(boss.health * 1.5);

  session.currentMonster = boss;
  session.monsterHealth = enhancedHealth;
  session.monsterMaxHealth = enhancedHealth;
  session.monsterIsEnhanced = true;
  session.isBossFight = true;
  session.isPlayerTurn = true;
  session.playerDefending = false;
  session.combatLog = [];
  session.lastActionTime = Date.now();

  // Regenerar recursos antes del boss
  session.currentMana = Math.min(session.maxMana, session.currentMana + 10);
  session.currentStamina = Math.min(session.maxStamina, session.currentStamina + 15);

  let msg = `\n👹 *¡EL BOSS APARECE!*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `${boss.emoji} *${boss.name}* 👑\n`;
  msg += `_"${boss.description}"_\n\n`;
  msg += `⚠️ *Stats mejorados:*\n`;
  msg += `   ❤️ Vida x1.5 | ⚔️ Ataque x1.2 | 🛡️ Defensa x1.2\n\n`;
  msg += `💀 _¡No puedes huir del boss!_\n`;

  await m.reply(msg);

  // Mostrar estado de combate
  const statusMsg = generateCombatStatus(session);
  await m.reply(statusMsg);
  startActionTimeout(session, ctx);
}

/**
 * Finaliza el dungeon
 */
async function endDungeon(
  session: DungeonSession,
  ctx: MessageContext,
  completed: boolean,
  reason: 'victory' | 'death' | 'flee' | 'timeout' | 'error'
) {
  const { m } = ctx;
  const db = getDatabase();
  const dungeon = session.dungeon;

  // Limpiar timeout
  if (session.actionTimeout) {
    clearTimeout(session.actionTimeout);
    session.actionTimeout = null;
  }

  // Aplicar multiplicadores del dungeon si completó
  if (completed) {
    session.expGained = Math.floor(session.expGained * dungeon.rewards.expMultiplier);
    session.moneyGained = Math.floor(session.moneyGained * dungeon.rewards.moneyMultiplier);

    // Drops garantizados
    for (const itemId of dungeon.rewards.guaranteedDrops) {
      session.itemsGained.push(itemId);
    }

    // Bonus drops
    for (const bonusDrop of dungeon.rewards.bonusDrops) {
      if (Math.random() <= bonusDrop.chance) {
        session.itemsGained.push(bonusDrop.itemId);
      }
    }
  } else {
    // Penalización por no completar
    const penalty = reason === 'death' ? 0.5 : (reason === 'flee' ? 0.3 : 0.2);
    session.expGained = Math.floor(session.expGained * penalty);
    session.moneyGained = Math.floor(session.moneyGained * penalty);
    session.itemsGained = []; // Pierdes los items
  }

  // Aplicar modos globales
  const modeMessages: string[] = [];

  if (globalModes.bonusMode.active) {
    const bonusExp = Math.floor(session.expGained * (globalModes.bonusMode.expMultiplier - 1));
    const bonusMoney = Math.floor(session.moneyGained * (globalModes.bonusMode.moneyMultiplier - 1));
    session.expGained += bonusExp;
    session.moneyGained += bonusMoney;
    modeMessages.push(`🎁 Modo Bonus: +${bonusExp} XP, +${bonusMoney} 💰`);
  }

  if (globalModes.pvpMode.active) {
    const pvpExp = Math.floor(session.expGained * (globalModes.pvpMode.damageMultiplier - 1));
    session.expGained += pvpExp;
    modeMessages.push(`⚔️ Modo PvP: +${pvpExp} XP`);
  }

  if (globalModes.chaosMode.active) {
    const chaosExp = Math.floor(session.expGained * (globalModes.chaosMode.multiplier - 1));
    const chaosMoney = Math.floor(session.moneyGained * (globalModes.chaosMode.multiplier - 1));
    session.expGained += chaosExp;
    session.moneyGained += chaosMoney;
    modeMessages.push(`🌀 Modo Caos: +${chaosExp} XP, +${chaosMoney} 💰`);
  }

  if (globalModes.eventMode.active) {
    const eventExp = Math.floor(session.expGained * (globalModes.eventMode.dropMultiplier - 1));
    const eventMoney = Math.floor(session.moneyGained * (globalModes.eventMode.dropMultiplier - 1));
    session.expGained += eventExp;
    session.moneyGained += eventMoney;
    modeMessages.push(`🎉 ${globalModes.eventMode.eventName}: +${eventExp} XP, +${eventMoney} 💰`);
  }

  // Obtener usuario actual
  const user = db.getUser(session.jid);

  // Actualizar estadísticas de combate
  const newCombatStats = { ...user.combatStats };
  newCombatStats.totalKills += session.monstersKilled;
  newCombatStats.totalDamageDealt += session.totalDamageDealt;

  if (completed) {
    newCombatStats.dungeonsCompleted++;
    newCombatStats.bossesKilled++;
  }

  // Agregar items al inventario
  for (const itemId of session.itemsGained) {
    const existingItem = user.inventory.find(i => i.itemId === itemId);
    if (existingItem) {
      existingItem.quantity++;
    } else {
      user.inventory.push({ itemId, quantity: 1 });
    }
  }

  // Guardar cambios
  db.updateUser(session.jid, {
    health: Math.max(1, session.currentHealth),
    exp: user.exp + session.expGained,
    money: user.money + session.moneyGained,
    totalEarned: user.totalEarned + session.moneyGained,
    combatStats: newCombatStats,
    inventory: user.inventory
  });

  // Construir mensaje de resultado
  let resultEmoji = completed ? '🏆' : (reason === 'death' ? '💀' : '🏃');
  let resultTitle = completed ? '¡DUNGEON COMPLETADO!' : (
    reason === 'death' ? '¡HAS CAÍDO!' :
    reason === 'flee' ? 'ESCAPASTE' :
    reason === 'timeout' ? 'TIEMPO AGOTADO' : 'ERROR'
  );

  let msg = `\n${resultEmoji} *${resultTitle}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `${dungeon.emoji} *${dungeon.name}*\n\n`;

  // Log final de combate
  if (session.combatLog.length > 0) {
    msg += `📜 *Últimas acciones:*\n`;
    for (const line of session.combatLog.slice(-4)) {
      msg += `   ${line}\n`;
    }
    msg += '\n';
  }

  msg += `📊 *Resultados:*\n`;
  msg += `   💀 Monstruos: ${session.monstersKilled}\n`;
  msg += `   ${EMOJI.exp} XP: +${formatNumber(session.expGained)}\n`;
  msg += `   ${EMOJI.coin} Monedas: +${formatNumber(session.moneyGained)}\n`;

  if (session.itemsGained.length > 0) {
    const itemNames = session.itemsGained.map(id => {
      const item = ITEMS[id];
      return item ? `${item.emoji} ${item.name}` : id;
    });
    msg += `   🎁 Items: ${itemNames.join(', ')}\n`;
  }

  // Modos activos
  if (modeMessages.length > 0) {
    msg += `\n🎮 *Bonificaciones:*\n`;
    msg += modeMessages.map(m => `   ${m}`).join('\n') + '\n';
  }

  msg += `\n❤️ Salud: *${Math.max(1, session.currentHealth)}/${session.maxHealth}*\n`;

  // Penalización IMSS si murió
  if (reason === 'death') {
    const freshUser = db.getUser(session.jid);
    const imssResult = applyDeathPenalty(db, session.jid, freshUser);
    msg += generateIMSSMessage(imssResult, session.playerName);
    db.updateUser(session.jid, { health: 1 });
  }

  msg += `\n⏰ Próximo dungeon: *30 minutos*`;

  // Limpiar sesión
  cleanupDungeonSession(session.jid);

  await m.reply(msg);
  await m.react(completed ? '🏆' : '💀');

  // Actualizar misiones
  if (completed) {
    updateQuestProgress(db, session.jid, 'dungeon', 1);
  }
  if (session.moneyGained > 0) {
    updateQuestProgress(db, session.jid, 'earn', session.moneyGained);
  }
}

// ==================== PLUGINS ====================

/**
 * Plugin: Dungeon Interactivo - Ver dungeons disponibles
 */
export const dungeonsInteractivoPlugin: PluginHandler = {
  command: ['dungeons', 'mazmorras', 'exploraciones'],
  tags: ['rpg'],
  help: [
    'dungeons - Ver todas las mazmorras disponibles',
    'Cada dungeon tiene diferentes dificultades y recompensas'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let response = `🏰 *DUNGEONS DISPONIBLES*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📊 Tu nivel: *${user.level}*\n`;
    response += `⚡ Tu energía: *${user.stamina}/${user.maxStamina}*\n\n`;

    for (const [dungeonId, dungeon] of Object.entries(DUNGEONS)) {
      const canEnter = user.level >= dungeon.requiredLevel;
      const hasStamina = user.stamina >= dungeon.staminaCost;
      const status = canEnter ? (hasStamina ? '✅' : '⚡') : '🔒';

      response += `${status} ${dungeon.emoji} *${dungeon.name}*\n`;
      response += `   📖 _${dungeon.description}_\n`;
      response += `   📊 Nivel: ${dungeon.requiredLevel}+ | ⚡ Costo: ${dungeon.staminaCost}\n`;
      response += `   🎁 XP x${dungeon.rewards.expMultiplier} | 💰 x${dungeon.rewards.moneyMultiplier}\n\n`;
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📝 */dungeon [nombre]* - Modo interactivo ⚔️\n`;
    response += `📝 */dr [nombre]* - Modo rápido/automático ⚡\n`;
    response += `⏰ Cooldown: 30 minutos`;

    await m.reply(response);
  }
};

/**
 * Plugin: Dungeon Interactivo - Entrar a un dungeon
 */
export const dungeonInteractivoPlugin: PluginHandler = {
  command: ['dungeon', 'mazmorra', 'explorar'],
  tags: ['rpg'],
  help: [
    'dungeon [nombre] - Entra a una mazmorra interactiva',
    'Combate por turnos con decisiones estratégicas',
    'Usa /dr para modo automático rápido'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Limpiar sesiones inactivas antes de verificar
    cleanupInactiveSessions();

    // Verificar si ya tiene un dungeon activo
    if (activeDungeons.has(m.sender)) {
      const session = activeDungeons.get(m.sender)!;
      await m.reply(
        `${EMOJI.warning} Ya estás en un dungeon.\n\n` +
        `${session.dungeon.emoji} *${session.dungeon.name}*\n` +
        `Usa tus comandos de combate o *salir* para abandonar.`
      );
      // Mostrar estado actual
      if (session.currentMonster) {
        const statusMsg = generateCombatStatus(session);
        await m.reply(statusMsg);
      }
      return;
    }

    // Verificar modos globales expirados
    checkExpiredModes();

    // Verificar cooldown
    const now = Date.now();
    const lastDungeon = user.lastDungeon || 0;

    if (now - lastDungeon < DUNGEON_COOLDOWN) {
      const remaining = DUNGEON_COOLDOWN - (now - lastDungeon);
      await m.reply(
        `${EMOJI.time} Necesitas descansar después de tu última expedición.\n\n` +
        `⏳ Espera *${msToTime(remaining)}* para entrar a otro dungeon.`
      );
      return;
    }

    // Si no especifica dungeon, mostrar lista
    if (!text.trim()) {
      let recommendedDungeon: Dungeon | null = null;
      for (const dungeon of Object.values(DUNGEONS)) {
        if (user.level >= dungeon.requiredLevel) {
          recommendedDungeon = dungeon;
        }
      }

      let response = `${EMOJI.error} Especifica a qué dungeon quieres entrar.\n\n`;
      response += `📝 *Uso:* /dungeon cueva slimes\n\n`;
      response += `🏰 *Dungeons disponibles:*\n`;

      for (const dungeon of Object.values(DUNGEONS)) {
        const canEnter = user.level >= dungeon.requiredLevel;
        response += `   ${canEnter ? '✅' : '🔒'} ${dungeon.name} (Nv.${dungeon.requiredLevel}+)\n`;
      }

      if (recommendedDungeon) {
        response += `\n💡 *Recomendado:* ${recommendedDungeon.name}`;
      }

      response += `\n\n⚡ */dr* - Modo rápido (automático)`;

      await m.reply(response);
      return;
    }

    // Buscar dungeon
    const searchTerm = text.toLowerCase().trim();
    let selectedDungeon: Dungeon | null = null;

    for (const dungeon of Object.values(DUNGEONS)) {
      if (matchesIgnoreAccents(dungeon.name, searchTerm) ||
          dungeon.id.includes(searchTerm.replace(/\s+/g, '_'))) {
        selectedDungeon = dungeon;
        break;
      }
    }

    if (!selectedDungeon) {
      await m.reply(
        `${EMOJI.error} Dungeon no encontrado.\n\n` +
        `💡 Usa */dungeons* para ver las mazmorras disponibles.`
      );
      return;
    }

    // Verificar nivel
    if (user.level < selectedDungeon.requiredLevel) {
      await m.reply(
        `${EMOJI.error} Necesitas nivel *${selectedDungeon.requiredLevel}* para entrar.\n\n` +
        `📊 Tu nivel: *${user.level}*`
      );
      return;
    }

    // Verificar stamina
    if (user.stamina < selectedDungeon.staminaCost) {
      await m.reply(
        `${EMOJI.error} No tienes suficiente energía.\n\n` +
        `⚡ Requerida: *${selectedDungeon.staminaCost}*\n` +
        `⚡ Tu energía: *${user.stamina}/${user.maxStamina}*\n\n` +
        `💡 Espera o usa una poción de energía.`
      );
      return;
    }

    // Calcular stats del jugador
    const playerStats = calculateTotalStats(user, ITEMS, CLASSES);

    // Verificar salud
    if (user.health < PVP.MIN_HEALTH_DUNGEON) {
      await m.reply(
        `${EMOJI.error} Estás muy débil para entrar a un dungeon.\n\n` +
        `❤️ Salud: *${user.health}/${playerStats.maxHealth}*\n\n` +
        `💡 Cúrate antes de entrar.`
      );
      return;
    }

    await m.react('🏰');

    // Consumir stamina y aplicar cooldown
    db.updateUser(m.sender, {
      stamina: user.stamina - selectedDungeon.staminaCost,
      lastDungeon: now
    });

    // Crear sesión de dungeon
    const firstMonsterId = selectedDungeon.monsters[0];
    const firstMonster = MONSTERS[firstMonsterId];

    if (!firstMonster) {
      await m.reply(`${EMOJI.error} Error al iniciar el dungeon.`);
      return;
    }

    const session: DungeonSession = {
      jid: m.sender,
      groupJid: m.chat,
      dungeon: selectedDungeon,
      playerName: user.name,
      playerStats,
      playerClass: user.playerClass,
      playerLevel: user.level,
      currentHealth: user.health,
      maxHealth: playerStats.maxHealth,
      currentMana: user.mana,
      maxMana: playerStats.maxMana,
      currentStamina: user.stamina - selectedDungeon.staminaCost,
      maxStamina: playerStats.maxStamina,
      currentEncounterIndex: 0,
      isBossFight: false,
      currentMonster: firstMonster,
      monsterHealth: firstMonster.health,
      monsterMaxHealth: firstMonster.health,
      monsterIsEnhanced: false,
      isPlayerTurn: true,
      playerDefending: false,
      playerAttackBuff: 0,
      playerDefenseBuff: 0,
      buffDuration: 0,
      monstersKilled: 0,
      totalDamageDealt: 0,
      expGained: 0,
      moneyGained: 0,
      itemsGained: [],
      combatLog: [],
      startTime: now,
      lastActionTime: now,
      actionTimeout: null,
      skillCooldowns: new Map(),
      currentTurn: 1
    };

    activeDungeons.set(m.sender, session);

    // Mensaje de entrada
    let entryMsg = `${selectedDungeon.emoji} *${selectedDungeon.name.toUpperCase()}*\n`;
    entryMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    entryMsg += `📖 _${selectedDungeon.description}_\n\n`;
    entryMsg += `🚪 *Entrando al dungeon...*\n\n`;
    entryMsg += `⚔️ Encuentros: ${selectedDungeon.monsters.length} monstruos + 1 boss\n`;
    entryMsg += `🎯 Objetivo: Derrotar al boss final\n\n`;
    entryMsg += `💡 *Sistema de combate interactivo*\n`;
    entryMsg += `   • Toma decisiones cada turno\n`;
    entryMsg += `   • Usa habilidades y pociones\n`;
    entryMsg += `   • ¡Sobrevive al boss!\n`;

    await m.reply(entryMsg);

    // Primer encuentro
    let encounterMsg = `\n⚔️ *¡PRIMER ENCUENTRO!*\n`;
    encounterMsg += `${firstMonster.emoji} *${firstMonster.name}* (Nv.${firstMonster.level}) aparece!\n`;

    await m.reply(encounterMsg);

    // Mostrar estado de combate
    const statusMsg = generateCombatStatus(session);
    await m.reply(statusMsg);
    startActionTimeout(session, ctx);
  }
};

/**
 * Plugin: Atacar en dungeon
 */
export const atacarDungeonPlugin: PluginHandler = {
  command: ['a', 'atacar', 'attack', 'atk'],
  tags: ['rpg'],
  help: ['a - Atacar al monstruo actual en el dungeon'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    const session = activeDungeons.get(m.sender);
    if (!session) return; // No está en dungeon

    if (!session.isPlayerTurn) {
      await m.reply(`⏳ Espera tu turno...`);
      return;
    }

    // Limpiar timeout
    if (session.actionTimeout) {
      clearTimeout(session.actionTimeout);
      session.actionTimeout = null;
    }

    const monster = session.currentMonster!;
    session.isPlayerTurn = false;
    session.playerDefending = false;

    // Calcular ataque del jugador
    let playerAttack = session.playerStats.attack;
    if (session.buffDuration > 0 && session.playerAttackBuff > 0) {
      playerAttack = Math.floor(playerAttack * (1 + session.playerAttackBuff / 100));
    }

    let monsterDefense = monster.defense;
    if (session.monsterIsEnhanced) {
      monsterDefense = Math.floor(monsterDefense * 1.2);
    }

    const result = calculateDamage(playerAttack, monsterDefense, session.playerStats.critChance);
    session.monsterHealth = Math.max(0, session.monsterHealth - result.damage);
    session.totalDamageDealt += result.damage;

    // Log del ataque
    let attackLog = `⚔️ ${session.playerName} ataca → *${result.damage}*`;
    if (result.isCrit) attackLog += ' 💥CRIT!';
    session.combatLog.push(attackLog);

    // Verificar muerte del monstruo
    if (session.monsterHealth <= 0) {
      await processMonsterDeath(session, ctx);
      return;
    }

    // Turno del monstruo
    await processMonsterTurn(session, ctx);
  }
};

/**
 * Plugin: Defender en dungeon
 */
export const defenderDungeonPlugin: PluginHandler = {
  command: ['d', 'defender', 'defend', 'def'],
  tags: ['rpg'],
  help: ['d - Defenderse (reduce 50% daño, regenera maná)'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    const session = activeDungeons.get(m.sender);
    if (!session) return;

    if (!session.isPlayerTurn) {
      await m.reply(`⏳ Espera tu turno...`);
      return;
    }

    // Limpiar timeout
    if (session.actionTimeout) {
      clearTimeout(session.actionTimeout);
      session.actionTimeout = null;
    }

    session.isPlayerTurn = false;
    session.playerDefending = true;

    // Regenerar maná al defender
    session.currentMana = Math.min(session.maxMana, session.currentMana + DEFEND_MANA_REGEN);

    session.combatLog.push(`🛡️ ${session.playerName} se defiende (+${DEFEND_MANA_REGEN} 💙)`);

    // Turno del monstruo
    await processMonsterTurn(session, ctx);
  }
};

/**
 * Plugin: Usar habilidad en dungeon
 */
export const habilidadDungeonPlugin: PluginHandler = {
  command: ['h', 'habilidad', 'skill', 'poder'],
  tags: ['rpg'],
  help: ['h - Ver/usar habilidades de clase'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, args } = ctx;

    const session = activeDungeons.get(m.sender);
    if (!session) return;

    if (!session.isPlayerTurn) {
      await m.reply(`⏳ Espera tu turno...`);
      return;
    }

    // Si no especifica habilidad, mostrar menú
    const skillArg = args.join(' ').toLowerCase() || text.replace(/^h\s*/i, '').trim();

    if (!skillArg) {
      const menuMsg = generateSkillsMenu(session);
      await m.reply(menuMsg);
      return;
    }

    // Buscar habilidad por número o nombre
    const availableSkills = getAvailableSkills(session);
    let skill: Skill | undefined;

    // Por número (h1, h2, etc.)
    const numMatch = skillArg.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1]) - 1;
      if (index >= 0 && index < availableSkills.length) {
        skill = availableSkills[index];
      }
    }

    // Por nombre
    if (!skill) {
      skill = availableSkills.find(s =>
        s.name.toLowerCase().includes(skillArg) ||
        s.id.toLowerCase().includes(skillArg.replace(/\s+/g, '_'))
      );
    }

    if (!skill) {
      await m.reply(
        `${EMOJI.error} Habilidad no encontrada o no disponible.\n\n` +
        `💡 Usa *h* para ver tus habilidades.`
      );
      return;
    }

    // Verificar recursos
    if (session.currentMana < skill.manaCost) {
      await m.reply(`${EMOJI.error} No tienes suficiente maná (💙${skill.manaCost}).`);
      return;
    }
    if (session.currentStamina < skill.staminaCost) {
      await m.reply(`${EMOJI.error} No tienes suficiente energía (⚡${skill.staminaCost}).`);
      return;
    }

    // Verificar cooldown
    const cooldownEnd = session.skillCooldowns.get(skill.id) || 0;
    if (session.currentTurn < cooldownEnd) {
      await m.reply(`${EMOJI.error} *${skill.name}* en cooldown (${cooldownEnd - session.currentTurn} turnos).`);
      return;
    }

    // Limpiar timeout
    if (session.actionTimeout) {
      clearTimeout(session.actionTimeout);
      session.actionTimeout = null;
    }

    session.isPlayerTurn = false;
    session.playerDefending = false;

    // Consumir recursos
    session.currentMana -= skill.manaCost;
    session.currentStamina -= skill.staminaCost;

    // Aplicar cooldown
    if (skill.cooldown > 0) {
      session.skillCooldowns.set(skill.id, session.currentTurn + skill.cooldown);
    }

    const monster = session.currentMonster!;

    // Procesar efecto de la habilidad
    let skillLog = `${skill.emoji} ${session.playerName} usa *${skill.name}*`;
    let damage = 0;

    // Daño
    if (skill.effect.damageMultiplier) {
      let playerAttack = session.playerStats.attack;
      if (session.buffDuration > 0 && session.playerAttackBuff > 0) {
        playerAttack = Math.floor(playerAttack * (1 + session.playerAttackBuff / 100));
      }

      let monsterDefense = monster.defense;
      if (session.monsterIsEnhanced) {
        monsterDefense = Math.floor(monsterDefense * 1.2);
      }

      const result = calculateDamage(playerAttack, monsterDefense, session.playerStats.critChance, skill.effect.damageMultiplier);
      damage = result.damage;
      session.monsterHealth = Math.max(0, session.monsterHealth - damage);
      session.totalDamageDealt += damage;

      skillLog += ` → *${damage}*`;
      if (result.isCrit) skillLog += ' 💥';
    }

    // Curación (robo vital)
    if (skill.effect.heal && damage > 0) {
      const healAmount = Math.floor(damage * (skill.effect.heal / 100));
      session.currentHealth = Math.min(session.maxHealth, session.currentHealth + healAmount);
      skillLog += ` +${healAmount}❤️`;
    }

    // Buffs
    if (skill.effect.buff) {
      const buff = skill.effect.buff;
      if (buff.stat === 'attack') {
        session.playerAttackBuff = buff.value;
      } else if (buff.stat === 'defense') {
        session.playerDefenseBuff = buff.value;
      }
      session.buffDuration = buff.duration;
      skillLog += ` (+${buff.value}% ${buff.stat === 'attack' ? '⚔️' : '🛡️'} x${buff.duration}t)`;
    }

    session.combatLog.push(skillLog);

    // Verificar muerte del monstruo
    if (session.monsterHealth <= 0) {
      await processMonsterDeath(session, ctx);
      return;
    }

    // Turno del monstruo
    await processMonsterTurn(session, ctx);
  }
};

/**
 * Plugin: Usar item en dungeon
 */
export const itemDungeonPlugin: PluginHandler = {
  command: ['i', 'item', 'pocion', 'usar'],
  tags: ['rpg'],
  help: ['i - Ver/usar items consumibles'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, args } = ctx;
    const db = getDatabase();

    const session = activeDungeons.get(m.sender);
    if (!session) return;

    if (!session.isPlayerTurn) {
      await m.reply(`⏳ Espera tu turno...`);
      return;
    }

    const user = db.getUser(m.sender);

    // Filtrar consumibles
    const consumables = user.inventory.filter(inv => {
      const item = ITEMS[inv.itemId];
      return item && item.type === 'consumable' && item.consumeEffect &&
             (item.consumeEffect.health || item.consumeEffect.mana || item.consumeEffect.stamina);
    });

    // Si no especifica item, mostrar menú
    const itemArg = args.join(' ').toLowerCase() || text.replace(/^i\s*/i, '').trim();

    if (!itemArg) {
      const menuMsg = generateItemsMenu(session, user);
      await m.reply(menuMsg);
      return;
    }

    // Buscar item por número o nombre
    let selectedItem: { itemId: string; quantity: number } | undefined;
    let itemInfo: typeof ITEMS[string] | undefined;

    // Por número (i1, i2, etc.)
    const numMatch = itemArg.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1]) - 1;
      if (index >= 0 && index < consumables.length) {
        selectedItem = consumables[index];
        itemInfo = ITEMS[selectedItem.itemId];
      }
    }

    // Por nombre
    if (!selectedItem) {
      selectedItem = consumables.find(inv => {
        const item = ITEMS[inv.itemId];
        return item && (
          item.name.toLowerCase().includes(itemArg) ||
          inv.itemId.toLowerCase().includes(itemArg)
        );
      });
      if (selectedItem) {
        itemInfo = ITEMS[selectedItem.itemId];
      }
    }

    if (!selectedItem || !itemInfo) {
      await m.reply(
        `${EMOJI.error} Item no encontrado o no tienes.\n\n` +
        `💡 Usa *i* para ver tu inventario.`
      );
      return;
    }

    // Usar item (no consume turno pero aplica timeout)
    const effect = itemInfo.consumeEffect!;
    const effects: string[] = [];

    if (effect.health) {
      const healAmount = Math.min(effect.health, session.maxHealth - session.currentHealth);
      session.currentHealth += healAmount;
      effects.push(`+${healAmount} ❤️`);
    }
    if (effect.mana) {
      const manaAmount = Math.min(effect.mana, session.maxMana - session.currentMana);
      session.currentMana += manaAmount;
      effects.push(`+${manaAmount} 💙`);
    }
    if (effect.stamina) {
      const staminaAmount = Math.min(effect.stamina, session.maxStamina - session.currentStamina);
      session.currentStamina += staminaAmount;
      effects.push(`+${staminaAmount} ⚡`);
    }

    // Consumir item del inventario
    const invItem = user.inventory.find(i => i.itemId === selectedItem!.itemId);
    if (invItem) {
      invItem.quantity--;
      if (invItem.quantity <= 0) {
        user.inventory = user.inventory.filter(i => i.itemId !== selectedItem!.itemId);
      }
    }
    db.updateUser(m.sender, { inventory: user.inventory });

    session.combatLog.push(`🧪 ${session.playerName} usa ${itemInfo.emoji} ${itemInfo.name} (${effects.join(' ')})`);

    // Mostrar estado actualizado (usar item no gasta turno)
    await m.reply(`✅ Usaste ${itemInfo.emoji} *${itemInfo.name}*\n${effects.join(' | ')}`);

    // Mostrar estado de combate
    const statusMsg = generateCombatStatus(session);
    await m.reply(statusMsg);

    // Reiniciar timeout (usar item no gasta turno pero reinicia el tiempo)
    startActionTimeout(session, ctx);
  }
};

/**
 * Plugin: Huir del dungeon
 */
export const huirDungeonPlugin: PluginHandler = {
  command: ['huir', 'escapar', 'flee', 'salir'],
  tags: ['rpg'],
  help: ['huir - Escapar del dungeon (pierdes recompensas)'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    const session = activeDungeons.get(m.sender);
    if (!session) return;

    // No se puede huir del boss
    if (session.isBossFight) {
      await m.reply(`💀 *¡No puedes huir del boss!*\n\n_Debes enfrentarlo o morir en el intento..._`);
      return;
    }

    // Limpiar timeout
    if (session.actionTimeout) {
      clearTimeout(session.actionTimeout);
      session.actionTimeout = null;
    }

    // Calcular probabilidad de huir
    let fleeChance = FLEE_BASE_CHANCE;
    // Bonus por velocidad/agilidad (stamina)
    fleeChance += (session.currentStamina / session.maxStamina) * 0.2;

    if (Math.random() <= fleeChance) {
      // Éxito al huir
      session.combatLog.push(`🏃 ${session.playerName} escapa del dungeon!`);
      await endDungeon(session, ctx, false, 'flee');
    } else {
      // Fallo al huir - el monstruo ataca con ventaja
      session.combatLog.push(`🏃 ${session.playerName} intenta huir... ¡FALLA!`);
      session.isPlayerTurn = false;
      await m.reply(`❌ *¡No pudiste escapar!*\n_El monstruo aprovecha tu descuido..._`);
      await processMonsterTurn(session, ctx);
    }
  }
};

/**
 * Plugin: Estado del dungeon
 */
export const estadoDungeonPlugin: PluginHandler = {
  command: ['estado', 'status', 'st'],
  tags: ['rpg'],
  help: ['estado - Ver estado actual del combate'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    const session = activeDungeons.get(m.sender);
    if (!session) {
      await m.reply(`${EMOJI.info} No estás en ningún dungeon.`);
      return;
    }

    const statusMsg = generateCombatStatus(session);
    await m.reply(statusMsg);
  }
};

export default dungeonInteractivoPlugin;
