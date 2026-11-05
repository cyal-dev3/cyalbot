import type { PluginHandler, MessageContext, SerializedMessage, CommandContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime } from '../lib/utils.js';
import { ITEMS, CLASSES, SKILLS, type Dungeon, type Skill } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';
import { PVE, PVP } from '../constants/rpg.js';
import { calculateDamage, type TotalStats } from '../lib/rpg-utils.js';
import { createLogger } from '../lib/logger.js';
import { checkExpiredModes } from '../lib/global-modes.js';
import {
  applySkillEffect, clearBusy, consumeEvasion, createCombatState, effectiveAttack, effectiveDefense, getDropLuck,
  grantCombatRewards, handlePlayerDeath, playerStats, setBusy, tickEffects, type CombatantState
} from '../lib/rpg-combat.js';
import { countItem, formatAmbiguous, inventoryItems, removeItem, resolveItem } from '../lib/rpg-inventory.js';
import { addPetExp } from './rpg-mascotas.js';
import {
  buildEncounters, finalizeDungeonLoot, healthBar, monsterDrops, monsterRewards, type DungeonEndReason, type Encounter
} from './rpg-dungeon-common.js';

const log = createLogger('rpg');
const D = PVE.DUNGEON;
const PET_EXP_PER_DUNGEON = 40;

interface DungeonSession {
  jid: string;
  chat: string;
  ctx: MessageContext;
  dungeon: Dungeon;
  playerName: string;
  playerClass: UserRPG['playerClass'];
  stats: TotalStats;
  currentHealth: number;
  maxHealth: number;
  currentMana: number;
  maxMana: number;
  currentStamina: number;
  maxStamina: number;
  encounters: Encounter[];
  encounterIndex: number;
  monsterHealth: number;
  monsterMaxHealth: number;
  playerState: CombatantState;
  monsterState: CombatantState;
  isPlayerTurn: boolean;
  defending: boolean;
  monstersKilled: number;
  totalDamageDealt: number;
  exp: number;
  money: number;
  items: string[];
  luckBonus: number;
  log: string[];
  startTime: number;
  /** Última acción del jugador; los turnos automáticos no la refrescan */
  lastActionTime: number;
  timeouts: number;
  actionTimeout: NodeJS.Timeout | null;
  skillCooldowns: Map<string, number>;
  turn: number;
}

export const activeDungeons = new Map<string, DungeonSession>();

let cleanupTimer: NodeJS.Timeout | null = null;

function cleanupInactiveSessions(now: number = Date.now()): void {
  for (const session of [...activeDungeons.values()]) {
    if (now - session.lastActionTime > D.SESSION_INACTIVITY) {
      log.info(`dungeon de ${session.jid} abandonado por inactividad`);
      void endDungeon(session, 'timeout');
    }
  }
}

/** Arranca el barrido de sesiones colgadas; lo llama index.ts al iniciar */
export function startDungeonCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => cleanupInactiveSessions(), D.CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

export function stopDungeonCleanup(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}

function currentEncounter(session: DungeonSession): Encounter {
  return session.encounters[session.encounterIndex];
}

function availableSkills(session: DungeonSession): Skill[] {
  if (!session.playerClass) return [];
  const classInfo = CLASSES[session.playerClass];
  if (!classInfo) return [];
  return classInfo.skills.map(id => SKILLS[id]).filter((s): s is Skill => Boolean(s));
}

function skillReady(session: DungeonSession, skill: Skill): { ready: boolean; reason?: string } {
  if (session.currentMana < skill.manaCost) return { ready: false, reason: `💙${skill.manaCost}` };
  if (session.currentStamina < skill.staminaCost) return { ready: false, reason: `⚡${skill.staminaCost}` };
  const until = session.skillCooldowns.get(skill.id) || 0;
  if (session.turn < until) return { ready: false, reason: `⏳${until - session.turn}t` };
  return { ready: true };
}

export function formatSessionStatus(session: DungeonSession): string {
  const encounter = currentEncounter(session);
  const monster = encounter.monster;
  const dungeon = session.dungeon;

  let msg = `${dungeon.emoji} *${dungeon.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += encounter.boss
    ? `👹 BOSS FINAL | 🔄 Turno ${session.turn}\n\n`
    : `⚔️ Encuentro ${session.encounterIndex + 1}/${session.encounters.length - 1} | 🔄 Turno ${session.turn}\n\n`;

  msg += `${monster.emoji} *${monster.name}* ${encounter.boss ? '👑' : ''}\n`;
  msg += `   Nv.${monster.level} | [${healthBar(session.monsterHealth, session.monsterMaxHealth)}]\n`;
  msg += `   ❤️ ${session.monsterHealth}/${session.monsterMaxHealth}\n`;
  const debuff = session.monsterState.effects.find(e => e.type === 'defenseDown');
  if (debuff) msg += `   🪤 -${debuff.value}% defensa (${debuff.remaining} acciones)\n`;
  msg += '\n';

  msg += `🧙 *${session.playerName}*${session.defending ? ' 🛡️' : ''}\n`;
  msg += `   [${healthBar(session.currentHealth, session.maxHealth)}] ❤️ ${session.currentHealth}/${session.maxHealth}\n`;
  msg += `   💙 ${session.currentMana}/${session.maxMana} | ⚡ ${session.currentStamina}/${session.maxStamina}\n`;
  const buffs = session.playerState.effects.map(e =>
    e.type === 'attackUp' ? `⚔️+${e.value}% (${e.remaining})` :
    e.type === 'defenseUp' ? `🛡️+${e.value}% (${e.remaining})` :
    e.type === 'evading' ? '💨 evasión' : '');
  if (buffs.some(Boolean)) msg += `   ✨ ${buffs.filter(Boolean).join(' ')}\n`;
  msg += '\n';

  if (session.log.length > 0) {
    msg += `📜 *Combate:*\n${session.log.slice(-3).map(l => `   ${l}`).join('\n')}\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n📝 *Acciones:*\n`;
  msg += `   ⚔️ *a* - Atacar\n`;
  msg += `   🛡️ *d* - Defender (+${D.DEFEND_MANA_REGEN}💙, -${Math.round(D.DEFEND_REDUCTION * 100)}% daño)\n`;
  msg += `   🎒 *i* - Usar poción\n`;
  if (availableSkills(session).length > 0) msg += `   ✨ *h* - Usar habilidad\n`;
  if (!encounter.boss) msg += `   🏃 *huir* - Escapar del dungeon\n`;
  msg += `\n⏰ _Tienes ${Math.round(D.ACTION_TIMEOUT / 1000)} segundos para actuar_`;
  if (session.timeouts > 0) msg += ` _(${session.timeouts}/${D.MAX_TIMEOUTS} turnos perdidos)_`;
  return msg;
}

function formatSkillsMenu(session: DungeonSession): string {
  const classInfo = session.playerClass ? CLASSES[session.playerClass] : null;
  let msg = `✨ *HABILIDADES*${classInfo ? ` (${classInfo.emoji} ${classInfo.name})` : ''}\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (!classInfo) {
    return msg + `❌ No tienes una clase asignada.\n\n💡 Usa */clases* para ver las clases y */clase [nombre]* para elegir una.`;
  }
  msg += `💙 Maná: ${session.currentMana}/${session.maxMana}\n⚡ Energía: ${session.currentStamina}/${session.maxStamina}\n\n`;
  availableSkills(session).forEach((skill, i) => {
    const state = skillReady(session, skill);
    msg += `*${i + 1}.* ${skill.emoji} *${skill.name}* ${state.ready ? '✅' : `❌ ${state.reason}`}\n`;
    msg += `   ${skill.description}\n   💙${skill.manaCost} ⚡${skill.staminaCost}${skill.cooldown > 0 ? ` | CD: ${skill.cooldown}t` : ''}\n\n`;
  });
  msg += `━━━━━━━━━━━━━━━━━━━━━\n📝 Usa *h1*, *h2*... o *h [nombre]*`;
  return msg;
}

function usableConsumables(user: UserRPG) {
  return inventoryItems(user).filter(item =>
    item.type === 'consumable' && item.consumeEffect &&
    Boolean(item.consumeEffect.health || item.consumeEffect.mana || item.consumeEffect.stamina));
}

function formatItemsMenu(session: DungeonSession, user: UserRPG): string {
  const consumables = usableConsumables(user);
  let msg = `🎒 *POCIONES*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (consumables.length === 0) return msg + `❌ No tienes pociones.\n\n💡 Compra en la tienda con */tienda consumibles*`;
  msg += `❤️ ${session.currentHealth}/${session.maxHealth} | 💙 ${session.currentMana}/${session.maxMana} | ⚡ ${session.currentStamina}/${session.maxStamina}\n\n`;
  consumables.forEach((item, i) => {
    const e = item.consumeEffect!;
    const effects = [e.health && `+${e.health} ❤️`, e.mana && `+${e.mana} 💙`, e.stamina && `+${e.stamina} ⚡`].filter(Boolean);
    msg += `*${i + 1}.* ${item.emoji} *${item.name}* x${countItem(user, item.id)}\n   ${effects.join(' | ')}\n\n`;
  });
  msg += `━━━━━━━━━━━━━━━━━━━━━\n📝 Usa *i1*, *i2*... o *i [nombre]* (no gasta turno)`;
  return msg;
}

function clearActionTimeout(session: DungeonSession): void {
  if (session.actionTimeout) clearTimeout(session.actionTimeout);
  session.actionTimeout = null;
}

function startActionTimeout(session: DungeonSession): void {
  clearActionTimeout(session);
  session.actionTimeout = setTimeout(async () => {
    const current = activeDungeons.get(session.jid);
    if (!current || current.startTime !== session.startTime) return;
    session.actionTimeout = null;
    session.timeouts++;
    try {
      if (session.timeouts >= D.MAX_TIMEOUTS) {
        await session.ctx.m.reply(`⏰ *Demasiados turnos sin actuar.* Abandonas el dungeon.`);
        await endDungeon(session, 'timeout');
        return;
      }
      await session.ctx.m.reply(`⏰ *¡Tiempo agotado!* El monstruo aprovecha tu distracción... (${session.timeouts}/${D.MAX_TIMEOUTS})`);
      session.isPlayerTurn = false;
      await processMonsterTurn(session);
    } catch (error) {
      log.error('timeout de dungeon:', error);
    }
  }, D.ACTION_TIMEOUT);
}

async function showStatus(session: DungeonSession): Promise<void> {
  await session.ctx.m.reply(formatSessionStatus(session));
  startActionTimeout(session);
}

async function processMonsterTurn(session: DungeonSession): Promise<void> {
  const encounter = currentEncounter(session);
  const monster = encounter.monster;

  if (consumeEvasion(session.playerState)) {
    session.log.push(`💨 ${session.playerName} esquiva el ataque de ${monster.name}`);
  } else {
    const defense = effectiveDefense(session.stats.defense, session.playerState);
    const hit = calculateDamage(encounter.fighter.attack, defense, PVE.MONSTER_CRIT_CHANCE);
    let damage = hit.damage;
    if (session.defending) damage = Math.floor(damage * D.DEFEND_REDUCTION);
    session.currentHealth = Math.max(0, session.currentHealth - damage);

    let line = `${monster.emoji} ${monster.name} ataca → *${damage}*`;
    if (hit.isCrit) line += ' 💥CRIT';
    if (session.defending) line += ' 🛡️';
    session.log.push(line);
  }
  session.defending = false;

  if (session.currentHealth <= 0) {
    await endDungeon(session, 'death');
    return;
  }

  tickEffects(session.playerState);
  tickEffects(session.monsterState);
  session.isPlayerTurn = true;
  session.turn++;
  await showStatus(session);
}

async function processMonsterDeath(session: DungeonSession): Promise<void> {
  const encounter = currentEncounter(session);
  const rewards = monsterRewards(encounter.monster, encounter.boss);
  session.exp += rewards.exp;
  session.money += rewards.money;
  session.monstersKilled++;
  session.items.push(...monsterDrops(encounter.monster, encounter.boss, session.luckBonus));
  session.log.push(`✅ *${encounter.monster.name}* derrotado!`);

  if (encounter.boss) {
    await endDungeon(session, 'victory');
    return;
  }

  session.encounterIndex++;
  const next = currentEncounter(session);
  session.monsterHealth = next.fighter.health;
  session.monsterMaxHealth = next.fighter.health;
  session.monsterState = createCombatState();
  session.isPlayerTurn = true;
  session.defending = false;
  session.log = [];

  const regen = next.boss ? D.REGEN_BEFORE_BOSS : D.REGEN_BETWEEN;
  session.currentMana = Math.min(session.maxMana, session.currentMana + regen.MANA);
  session.currentStamina = Math.min(session.maxStamina, session.currentStamina + regen.STAMINA);

  if (next.boss) {
    const mult = D.BOSS_STATS_MULTIPLIER;
    await session.ctx.m.reply(
      `\n👹 *¡EL BOSS APARECE!*\n━━━━━━━━━━━━━━━━━━━━━\n\n${next.monster.emoji} *${next.monster.name}* 👑\n_"${next.monster.description}"_\n\n` +
      `⚠️ *Stats mejorados:* ❤️ x${mult.HEALTH} | ⚔️ x${mult.ATTACK} | 🛡️ x${mult.DEFENSE}\n\n💀 _¡No puedes huir del boss!_`
    );
  } else {
    await session.ctx.m.reply(`\n🚪 *Avanzas más profundo...*\n\n⚔️ *¡Nuevo encuentro!*\n${next.monster.emoji} *${next.monster.name}* (Nv.${next.monster.level}) aparece!`);
  }
  await showStatus(session);
}

async function endDungeon(session: DungeonSession, reason: DungeonEndReason): Promise<void> {
  clearActionTimeout(session);
  activeDungeons.delete(session.jid);
  clearBusy(session.jid);

  const db = getDatabase();
  const { m } = session.ctx;
  const dungeon = session.dungeon;
  const completed = reason === 'victory';
  const diedToBoss = reason === 'death' && currentEncounter(session).boss;

  const loot = finalizeDungeonLoot(dungeon, { exp: session.exp, money: session.money, items: session.items }, reason, { diedToBoss, luckBonus: session.luckBonus });

  const user = db.getUser(session.jid);
  const combatStats = { ...user.combatStats };
  combatStats.totalKills += session.monstersKilled;
  combatStats.totalDamageDealt += session.totalDamageDealt;
  if (completed) {
    combatStats.dungeonsCompleted++;
    combatStats.bossesKilled++;
  }
  const petLeveled = completed && addPetExp(user.pet, PET_EXP_PER_DUNGEON);

  // Vida, maná y energía gastados dentro del dungeon se persisten
  db.updateUser(session.jid, {
    health: reason === 'death' ? 0 : Math.max(1, Math.min(session.currentHealth, session.maxHealth)),
    mana: Math.max(0, Math.min(session.currentMana, session.maxMana)),
    stamina: Math.max(0, Math.min(session.currentStamina, session.maxStamina)),
    combatStats,
    pet: user.pet
  });

  const rewards = grantCombatRewards(db, session.jid, {
    exp: loot.exp,
    money: loot.money,
    items: loot.items,
    quest: completed ? { objective: 'dungeon', amount: 1 } : undefined
  });

  const title = completed ? '🏆 *¡DUNGEON COMPLETADO!*'
    : reason === 'death' ? '💀 *¡HAS CAÍDO!*'
    : reason === 'flee' ? '🏃 *ESCAPASTE*'
    : reason === 'timeout' ? '⏰ *DUNGEON ABANDONADO*' : '❌ *ERROR*';

  let msg = `\n${title}\n━━━━━━━━━━━━━━━━━━━━━\n\n${dungeon.emoji} *${dungeon.name}*\n\n`;
  if (session.log.length > 0) msg += `📜 *Últimas acciones:*\n${session.log.slice(-4).map(l => `   ${l}`).join('\n')}\n\n`;
  msg += `📊 *Resultados:*\n`;
  msg += `   💀 Monstruos: ${session.monstersKilled}\n`;
  msg += `   ${EMOJI.exp} XP: +${formatNumber(rewards.exp)}\n`;
  msg += `   ${EMOJI.coin} Monedas: +${formatNumber(rewards.money)}\n`;
  if (rewards.items.length > 0) msg += `   🎁 Botín: ${rewards.items.join(', ')}\n`;
  if (rewards.lost.length > 0) msg += `   ${EMOJI.warning} Inventario lleno, se perdió: ${rewards.lost.join(', ')}\n`;
  if (!completed && session.items.length > 0) msg += `   _Los drops recogidos se perdieron al no completar el dungeon_\n`;
  if (rewards.lines.length > 0) msg += `\n🎮 *Bonificaciones:*\n${rewards.lines.map(l => `   ${l}`).join('\n')}\n`;
  if (petLeveled && user.pet) msg += `\n🐾 ¡Tu mascota *${user.pet.name}* subió al nivel ${user.pet.level}!\n`;

  if (reason === 'death') {
    const death = handlePlayerDeath(db, session.jid, session.playerName);
    msg += `\n❤️ Salud: *1/${session.maxHealth}*\n${death.message}`;
  } else {
    msg += `\n❤️ Salud: *${Math.max(1, session.currentHealth)}/${session.maxHealth}*`;
  }
  msg += `\n\n⏰ Próximo dungeon: *${msToTime(PVP.DUNGEON_COOLDOWN)}*`;

  await m.reply(msg);
  await m.react(completed ? '🏆' : '💀');
}

/**
 * Crea la sesión interactiva: cobra energía y cooldown, marca al jugador como
 * ocupado y muestra el primer encuentro. Las comprobaciones de entrada
 * (checkDungeonEntry) las hace el comando antes de llamar.
 */
export async function startInteractiveDungeon(ctx: MessageContext, user: UserRPG, dungeon: Dungeon): Promise<void> {
  const { m } = ctx;
  const encounters = buildEncounters(dungeon);
  if (encounters.length < 2) {
    await m.reply(`${EMOJI.error} Ese dungeon no tiene encuentros configurados.`);
    return;
  }
  if (!setBusy(m.sender, 'dungeon')) {
    await m.reply(`${EMOJI.error} Ya estás en otra actividad.`);
    return;
  }

  checkExpiredModes();
  const now = Date.now();
  const stats = playerStats(user);
  const stamina = user.stamina - dungeon.staminaCost;
  getDatabase().updateUser(m.sender, { stamina, lastDungeon: now });

  const first = encounters[0];
  const session: DungeonSession = {
    jid: m.sender,
    chat: m.chat,
    ctx,
    dungeon,
    playerName: user.name,
    playerClass: user.playerClass,
    stats,
    currentHealth: Math.min(user.health, stats.maxHealth),
    maxHealth: stats.maxHealth,
    currentMana: Math.min(user.mana, stats.maxMana),
    maxMana: stats.maxMana,
    currentStamina: Math.min(stamina, stats.maxStamina),
    maxStamina: stats.maxStamina,
    encounters,
    encounterIndex: 0,
    monsterHealth: first.fighter.health,
    monsterMaxHealth: first.fighter.health,
    playerState: createCombatState(),
    monsterState: createCombatState(),
    isPlayerTurn: true,
    defending: false,
    monstersKilled: 0,
    totalDamageDealt: 0,
    exp: 0,
    money: 0,
    items: [],
    luckBonus: getDropLuck(user, now),
    log: [],
    startTime: now,
    lastActionTime: now,
    timeouts: 0,
    actionTimeout: null,
    skillCooldowns: new Map(),
    turn: 1
  };
  activeDungeons.set(m.sender, session);

  await m.react('🏰');
  await m.reply(
    `${dungeon.emoji} *${dungeon.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n📖 _${dungeon.description}_\n\n` +
    `🚪 *Entrando al dungeon...*\n\n⚔️ Encuentros: ${encounters.length - 1} monstruos + 1 boss\n🎯 Objetivo: derrotar al boss final\n\n` +
    `💡 Escribe *a*, *d*, *h* o *i* sin prefijo en cada turno.\n\n` +
    `⚔️ *¡PRIMER ENCUENTRO!*\n${first.monster.emoji} *${first.monster.name}* (Nv.${first.monster.level}) aparece!`
  );
  await showStatus(session);
}

/** Sesión del remitente si es su turno; responde y devuelve null si no */
async function sessionForAction(ctx: MessageContext): Promise<DungeonSession | null> {
  const session = activeDungeons.get(ctx.m.sender);
  if (!session) return null;
  if (!session.isPlayerTurn) {
    await ctx.m.reply(`⏳ Espera tu turno...`);
    return null;
  }
  session.lastActionTime = Date.now();
  return session;
}

function beginPlayerAction(session: DungeonSession): void {
  clearActionTimeout(session);
  session.isPlayerTurn = false;
  session.defending = false;
}

async function resolvePlayerHit(session: DungeonSession, multiplier: number, label: string): Promise<number> {
  const encounter = currentEncounter(session);
  const attack = effectiveAttack(session.stats.attack, session.playerState);
  const defense = effectiveDefense(encounter.fighter.defense, session.monsterState);
  const hit = calculateDamage(attack, defense, session.stats.critChance, multiplier);
  session.monsterHealth = Math.max(0, session.monsterHealth - hit.damage);
  session.totalDamageDealt += hit.damage;
  session.log.push(`${label} → *${hit.damage}*${hit.isCrit ? ' 💥CRIT' : ''}`);
  return hit.damage;
}

const atacarDungeonPlugin: PluginHandler = {
  command: ['a', 'atacar', 'attack', 'atk'],
  tags: ['rpg'],
  help: ['a - Atacar al monstruo actual en el dungeon'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const session = await sessionForAction(ctx);
    if (!session) return;
    beginPlayerAction(session);

    await resolvePlayerHit(session, 1, `⚔️ ${session.playerName} ataca`);
    if (session.monsterHealth <= 0) {
      await processMonsterDeath(session);
      return;
    }
    await processMonsterTurn(session);
  }
};

const defenderDungeonPlugin: PluginHandler = {
  command: ['d', 'defender', 'defend', 'def', 'b', 'bloquear'],
  tags: ['rpg'],
  help: ['d - Defenderse (reduce el daño y regenera maná)'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const session = await sessionForAction(ctx);
    if (!session) return;
    beginPlayerAction(session);

    session.defending = true;
    session.currentMana = Math.min(session.maxMana, session.currentMana + D.DEFEND_MANA_REGEN);
    session.log.push(`🛡️ ${session.playerName} se defiende (+${D.DEFEND_MANA_REGEN} 💙)`);
    await processMonsterTurn(session);
  }
};

const habilidadDungeonPlugin: PluginHandler = {
  command: /^(h|habilidad|skill|poder|p|h\d+)$/i,
  tags: ['rpg'],
  help: ['h - Ver habilidades | h1, h2... o h [nombre] - Usar una habilidad'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, command } = ctx;
    const session = await sessionForAction(ctx);
    if (!session) return;

    const inline = command.match(/^h(\d+)$/i)?.[1];
    const term = (inline ?? args.join(' ')).toLowerCase().trim();
    const skills = availableSkills(session);

    if (!term) {
      await m.reply(formatSkillsMenu(session));
      return;
    }

    let skill: Skill | undefined;
    if (/^\d+$/.test(term)) {
      skill = skills[parseInt(term, 10) - 1];
    } else {
      const found = resolveItem(term, skills);
      if (found.status === 'ambiguous') {
        await m.reply(formatAmbiguous(found.candidates, 'Usa el número: h1, h2...'));
        return;
      }
      if (found.status === 'found') skill = found.item;
    }

    if (!skill) {
      await m.reply(`${EMOJI.error} Habilidad no encontrada.\n\n💡 Usa *h* para ver tus habilidades.`);
      return;
    }
    const state = skillReady(session, skill);
    if (!state.ready) {
      await m.reply(`${EMOJI.error} *${skill.name}* no está disponible (${state.reason}).`);
      return;
    }

    beginPlayerAction(session);
    session.currentMana -= skill.manaCost;
    session.currentStamina -= skill.staminaCost;
    if (skill.cooldown > 0) session.skillCooldowns.set(skill.id, session.turn + skill.cooldown);

    const effects = applySkillEffect(skill, session.playerState, session.monsterState);
    let damage = 0;
    if (skill.effect.damageMultiplier) {
      damage = await resolvePlayerHit(session, skill.effect.damageMultiplier, `${skill.emoji} ${session.playerName} usa *${skill.name}*`);
    } else {
      session.log.push(`${skill.emoji} ${session.playerName} usa *${skill.name}*`);
    }
    if (skill.effect.heal && damage > 0) {
      const heal = Math.floor(damage * (skill.effect.heal / 100));
      session.currentHealth = Math.min(session.maxHealth, session.currentHealth + heal);
      session.log.push(`💚 recupera ${heal} de vida`);
    }
    for (const line of effects.lines) session.log.push(line);

    if (session.monsterHealth <= 0) {
      await processMonsterDeath(session);
      return;
    }
    await processMonsterTurn(session);
  }
};

const itemDungeonPlugin: PluginHandler = {
  command: /^(i|item|pocion|usar|i\d+)$/i,
  tags: ['rpg'],
  help: ['i - Ver pociones | i1, i2... o i [nombre] - Usar una (no gasta turno)'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, command } = ctx;
    const session = await sessionForAction(ctx);
    if (!session) return;

    const db = getDatabase();
    const user = db.getUser(m.sender);
    const consumables = usableConsumables(user);
    const inline = command.match(/^i(\d+)$/i)?.[1];
    const term = (inline ?? args.join(' ')).toLowerCase().trim();

    if (!term) {
      await m.reply(formatItemsMenu(session, user));
      return;
    }

    let item = /^\d+$/.test(term) ? consumables[parseInt(term, 10) - 1] : undefined;
    if (!item) {
      const found = resolveItem(term, consumables);
      if (found.status === 'ambiguous') {
        await m.reply(formatAmbiguous(found.candidates, 'Usa el número: i1, i2...'));
        return;
      }
      if (found.status === 'found') item = found.item;
    }
    if (!item || !item.consumeEffect) {
      await m.reply(`${EMOJI.error} Poción no encontrada.\n\n💡 Usa *i* para ver tus pociones.`);
      return;
    }

    const effect = item.consumeEffect;
    const effects: string[] = [];
    if (effect.health) {
      const heal = Math.min(effect.health, session.maxHealth - session.currentHealth);
      session.currentHealth += heal;
      effects.push(`+${heal} ❤️`);
    }
    if (effect.mana) {
      const mana = Math.min(effect.mana, session.maxMana - session.currentMana);
      session.currentMana += mana;
      effects.push(`+${mana} 💙`);
    }
    if (effect.stamina) {
      const stamina = Math.min(effect.stamina, session.maxStamina - session.currentStamina);
      session.currentStamina += stamina;
      effects.push(`+${stamina} ⚡`);
    }

    removeItem(user, item.id, 1);
    db.updateUser(m.sender, { inventory: user.inventory });
    session.log.push(`🧪 ${session.playerName} usa ${item.emoji} ${item.name} (${effects.join(' ')})`);

    await m.reply(`✅ Usaste ${item.emoji} *${item.name}*\n${effects.join(' | ')}`);
    await showStatus(session);
  }
};

const huirDungeonPlugin: PluginHandler = {
  command: ['huir', 'escapar', 'flee', 'salir', 'rendirse'],
  tags: ['rpg'],
  help: ['huir - Escapar del dungeon (pierdes el botín)'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const session = await sessionForAction(ctx);
    if (!session) return;

    if (currentEncounter(session).boss) {
      await m.reply(`💀 *¡No puedes huir del boss!*\n\n_Debes enfrentarlo o morir en el intento..._`);
      return;
    }

    beginPlayerAction(session);
    const chance = D.FLEE_BASE_CHANCE + (session.maxStamina > 0 ? session.currentStamina / session.maxStamina : 0) * D.FLEE_STAMINA_BONUS;
    if (Math.random() <= chance) {
      session.log.push(`🏃 ${session.playerName} escapa del dungeon!`);
      await endDungeon(session, 'flee');
      return;
    }
    session.log.push(`🏃 ${session.playerName} intenta huir... ¡FALLA!`);
    await m.reply(`❌ *¡No pudiste escapar!*\n_El monstruo aprovecha tu descuido..._`);
    await processMonsterTurn(session);
  }
};

const estadoDungeonPlugin: PluginHandler = {
  command: ['estado', 'status', 'st'],
  tags: ['rpg'],
  help: ['estado - Ver el estado actual del combate'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const session = activeDungeons.get(ctx.m.sender);
    if (!session) return;
    await ctx.m.reply(formatSessionStatus(session));
  }
};

/** Acciones del dungeon: solo responden mientras el remitente tiene una sesión */
export const dungeonContext: CommandContext = {
  name: 'dungeon',
  isActive: (m: SerializedMessage) => activeDungeons.has(m.sender),
  plugins: [atacarDungeonPlugin, defenderDungeonPlugin, habilidadDungeonPlugin, itemDungeonPlugin, huirDungeonPlugin, estadoDungeonPlugin],
  noPrefix: true
};

/**
 * @deprecated Registro global antiguo (plugins/index.ts). Las acciones viven en
 * `dungeonContext` y el comando /dungeon en rpg-dungeon.ts. Quitar cuando
 * index.ts use registerCombatContexts.
 */
export { atacarDungeonPlugin, defenderDungeonPlugin, habilidadDungeonPlugin, itemDungeonPlugin, huirDungeonPlugin, estadoDungeonPlugin };

/** @deprecated Delegan en el /dungeon de rpg-dungeon.ts (import dinámico para no crear un ciclo). */
export const dungeonInteractivoPlugin: PluginHandler = {
  command: ['dungeon', 'dungeons', 'mazmorra', 'dr'],
  tags: ['rpg'],
  help: ['dungeon - Ver y entrar en mazmorras'],
  register: true,
  handler: async (ctx) => {
    const { dungeonPlugin } = await import('./rpg-dungeon.js');
    await dungeonPlugin.handler(ctx);
  }
};

/** @deprecated Igual que dungeonInteractivoPlugin. */
export const dungeonsInteractivoPlugin: PluginHandler = dungeonInteractivoPlugin;

/** Cierra a la fuerza la sesión de un jugador (owner); devuelve false si no tenía */
export async function cancelDungeon(jid: string): Promise<boolean> {
  const session = activeDungeons.get(jid);
  if (!session) return false;
  await endDungeon(session, 'timeout');
  return true;
}
