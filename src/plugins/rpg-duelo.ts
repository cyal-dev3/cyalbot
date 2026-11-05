import type { PluginHandler, MessageContext, SerializedMessage, CommandContext } from '../types/message.js';
import { getDatabase, type Database } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime, randomInt, pickRandom, getTargetUser, normalizeText } from '../lib/utils.js';
import { ITEMS, CLASSES, SKILLS, type PlayerClass, type Skill } from '../types/rpg.js';
import { getRankBenefits, getRoleByLevel, type RankBenefits, type UserRPG } from '../types/user.js';
import { PVP } from '../constants/rpg.js';
import { calculateDamage, type TotalStats } from '../lib/rpg-utils.js';
import { checkExpiredModes, pvpDamageMultiplier } from '../lib/global-modes.js';
import { createLogger } from '../lib/logger.js';
import {
  applySkillEffect, busyMessage, clearBusy, consumeEvasion, createCombatState, effectiveAttack, effectiveDefense,
  getBusy, grantCombatRewards, handlePlayerDeath, playerStats, setBusy, tickEffects, type CombatantState
} from '../lib/rpg-combat.js';
import { addPetExp } from './rpg-mascotas.js';

const log = createLogger('rpg');
const PET_EXP_PER_DUEL = 25;

/** Multiplicadores de habilidad reducidos para PvP (los de PvE matan de un golpe) */
const PVP_SKILL_MULTIPLIERS: Record<string, number> = {
  golpe_brutal: 1.25, escudo_defensor: 1.0, grito_guerra: 1.0,
  bola_fuego: 1.35, rayo_arcano: 1.25, escudo_magico: 1.0,
  ataque_furtivo: 1.4, evadir: 1.0, robo_vital: 1.15,
  disparo_preciso: 1.2, lluvia_flechas: 1.35, trampa_cazador: 1.0
};

/** Atajos para habilidades dentro del duelo */
const SKILL_ALIASES: Record<string, string> = {
  brutal: 'golpe_brutal', gb: 'golpe_brutal',
  escudo: 'escudo_defensor', defensor: 'escudo_defensor', ed: 'escudo_defensor',
  grito: 'grito_guerra', guerra: 'grito_guerra', gg: 'grito_guerra',
  fuego: 'bola_fuego', bola: 'bola_fuego', bf: 'bola_fuego',
  rayo: 'rayo_arcano', arcano: 'rayo_arcano', ra: 'rayo_arcano',
  escudomagico: 'escudo_magico', magico: 'escudo_magico', em: 'escudo_magico',
  furtivo: 'ataque_furtivo', af: 'ataque_furtivo',
  evadir: 'evadir', esquivar: 'evadir', ev: 'evadir',
  robo: 'robo_vital', vital: 'robo_vital', rv: 'robo_vital', robovital: 'robo_vital',
  disparo: 'disparo_preciso', preciso: 'disparo_preciso', dp: 'disparo_preciso',
  lluvia: 'lluvia_flechas', flechas: 'lluvia_flechas', lf: 'lluvia_flechas',
  trampa: 'trampa_cazador', cazador: 'trampa_cazador', tc: 'trampa_cazador'
};

/** Segundos de cooldown por cada turno de la habilidad (el duelo no tiene turnos) */
const SKILL_COOLDOWN_MS_PER_TURN = 3000;

const VICTORY_MESSAGES = [
  '🏆 *{winner}* derrotó a *{loser}* en un combate épico!',
  '⚔️ *{winner}* demostró su superioridad sobre *{loser}*!',
  '💀 *{loser}* cayó ante el poder de *{winner}*!',
  '🎖️ *{winner}* se alzó victorioso contra *{loser}*!',
  '👑 *{winner}* es el campeón! *{loser}* necesita entrenar más.'
];

// ==================== ESTADO ====================

export type Side = 'challenger' | 'target';

export interface DuelPlayer {
  jid: string;
  name: string;
  level: number;
  playerClass: PlayerClass | null;
  weaponId: string | null;
  stats: TotalStats;
  rank: RankBenefits;
  rankName: string;
  /** Vida del duelo (real x HEALTH_MULTIPLIER) */
  health: number;
  maxHealth: number;
  realMaxHealth: number;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  state: CombatantState;
  lastAction: number;
  skillCooldowns: Map<string, number>;
}

export interface ActiveDuel {
  players: Record<Side, DuelPlayer>;
  groupJid: string;
  bet: number;
  /** Dinero en depósito (apuesta de ambos), se paga al ganador o se devuelve */
  pot: number;
  startTime: number;
  lastAttacker: Side | null;
  consecutiveHits: number;
  totalActions: number;
  log: string[];
  timer: NodeJS.Timeout | null;
  finished: boolean;
}

interface PendingDuel {
  challengerJid: string;
  targetJid: string;
  groupJid: string;
  bet: number;
  timestamp: number;
  timer: NodeJS.Timeout;
}

const pendingDuels = new Map<string, PendingDuel>();
export const activeDuels = new Map<string, ActiveDuel>();

export function opposite(side: Side): Side {
  return side === 'challenger' ? 'target' : 'challenger';
}

export function sideOf(duel: ActiveDuel, jid: string): Side | null {
  if (duel.players.challenger.jid === jid) return 'challenger';
  if (duel.players.target.jid === jid) return 'target';
  return null;
}

export function createDuelPlayer(jid: string, user: UserRPG, now: number = Date.now()): DuelPlayer {
  const stats = playerStats(user);
  const realHealth = Math.min(user.health, stats.maxHealth);
  return {
    jid,
    name: user.name || jid.split('@')[0],
    level: user.level,
    playerClass: user.playerClass,
    weaponId: user.equipment?.weapon ?? null,
    stats,
    rank: getRankBenefits(user.level),
    rankName: getRoleByLevel(user.level),
    health: Math.floor(realHealth * PVP.HEALTH_MULTIPLIER),
    maxHealth: Math.floor(stats.maxHealth * PVP.HEALTH_MULTIPLIER),
    realMaxHealth: stats.maxHealth,
    mana: Math.min(user.mana, stats.maxMana),
    maxMana: stats.maxMana,
    stamina: Math.min(user.stamina, stats.maxStamina),
    maxStamina: stats.maxStamina,
    state: createCombatState(),
    lastAction: 0,
    skillCooldowns: new Map()
  };
}

/** Crea el duelo en memoria (sin temporizador ni descuento de apuesta) */
export function createDuel(
  challenger: { jid: string; user: UserRPG },
  target: { jid: string; user: UserRPG },
  groupJid: string,
  bet: number,
  now: number = Date.now()
): ActiveDuel {
  return {
    players: {
      challenger: createDuelPlayer(challenger.jid, challenger.user, now),
      target: createDuelPlayer(target.jid, target.user, now)
    },
    groupJid,
    bet,
    pot: bet * 2,
    startTime: now,
    lastAttacker: null,
    consecutiveHits: 0,
    totalActions: 0,
    log: [],
    timer: null,
    finished: false
  };
}

// ==================== ACCIONES ====================

export type DuelAction = { kind: 'attack' } | { kind: 'block' } | { kind: 'skill'; skill: Skill };

export interface DuelActionResult {
  ok: boolean;
  /** Motivo del rechazo cuando ok es false */
  error?: string;
  /** Lado ganador si la acción terminó el duelo */
  winner?: Side;
  /** Texto de la acción para el log */
  line?: string;
}

function skillCooldownLeft(player: DuelPlayer, skill: Skill, now: number): number {
  return Math.max(0, (player.skillCooldowns.get(skill.id) || 0) - now);
}

function classSkills(playerClass: PlayerClass | null): Skill[] {
  if (!playerClass) return [];
  return (CLASSES[playerClass]?.skills ?? []).map(id => SKILLS[id]).filter((s): s is Skill => Boolean(s));
}

/**
 * Resuelve una acción de `side`. Pura respecto a la BD: solo muta `duel`.
 * El plugin decide qué responder y llama a settleDuel si hay ganador.
 */
export function performDuelAction(duel: ActiveDuel, side: Side, action: DuelAction, now: number = Date.now()): DuelActionResult {
  if (duel.finished) return { ok: false, error: 'El duelo ya terminó.' };
  const attacker = duel.players[side];
  const defender = duel.players[opposite(side)];

  const sinceLast = now - attacker.lastAction;
  if (sinceLast < PVP.DUEL_ACTION_COOLDOWN) {
    return { ok: false, error: `⏳ Espera ${Math.ceil((PVP.DUEL_ACTION_COOLDOWN - sinceLast) / 1000)}s.` };
  }

  if (action.kind === 'block') {
    if (attacker.state.blocking) return { ok: false, error: `${EMOJI.warning} Ya estás en posición de bloqueo.` };
    if (attacker.stamina < PVP.DUEL_COSTS.BLOCK_STAMINA) return { ok: false, error: `${EMOJI.error} ¡Sin energía! Necesitas ${PVP.DUEL_COSTS.BLOCK_STAMINA} ⚡ para bloquear.` };
    attacker.lastAction = now;
    attacker.state.blocking = true;
    attacker.stamina -= PVP.DUEL_COSTS.BLOCK_STAMINA;
    attacker.mana = Math.min(attacker.maxMana, attacker.mana + PVP.DUEL_REGEN.MANA_PER_BLOCK);
    if (duel.lastAttacker === opposite(side)) duel.consecutiveHits = 0;
    duel.totalActions++;
    tickEffects(attacker.state);
    const line = `🛡️ *${attacker.name}* se prepara para bloquear`;
    duel.log.push(line);
    return { ok: true, line };
  }

  let skill: Skill | null = null;
  if (action.kind === 'skill') {
    skill = action.skill;
    if (!classSkills(attacker.playerClass).some(s => s.id === skill!.id)) {
      return { ok: false, error: `${EMOJI.error} Esa habilidad no es de tu clase.` };
    }
    if (attacker.mana < skill.manaCost || attacker.stamina < skill.staminaCost) {
      return { ok: false, error: `${EMOJI.error} Sin recursos para *${skill.name}* (💙${skill.manaCost} ⚡${skill.staminaCost})` };
    }
    const left = skillCooldownLeft(attacker, skill, now);
    if (left > 0) return { ok: false, error: `⏳ *${skill.name}* en cooldown. Espera *${Math.ceil(left / 1000)}s*` };
  } else if (attacker.stamina < PVP.DUEL_COSTS.ATTACK_STAMINA) {
    return { ok: false, error: `${EMOJI.error} ¡Sin energía! Necesitas ${PVP.DUEL_COSTS.ATTACK_STAMINA} ⚡ para atacar.` };
  }

  attacker.lastAction = now;
  duel.totalActions++;

  if (skill) {
    attacker.mana -= skill.manaCost;
    attacker.stamina = Math.min(attacker.maxStamina, attacker.stamina - skill.staminaCost + PVP.DUEL_REGEN.STAMINA_PER_SKILL);
    attacker.skillCooldowns.set(skill.id, now + Math.max(1, skill.cooldown) * SKILL_COOLDOWN_MS_PER_TURN);
  } else {
    attacker.stamina -= PVP.DUEL_COSTS.ATTACK_STAMINA;
    attacker.mana = Math.min(attacker.maxMana, attacker.mana + PVP.DUEL_REGEN.MANA_PER_ACTION);
  }

  const effects = skill ? applySkillEffect(skill, attacker.state, defender.state) : { lines: [], dealsDamage: true };
  let line = skill ? `${skill.emoji} *${attacker.name}* → *${skill.name}*` : `${attacker.weaponId ? ITEMS[attacker.weaponId]?.emoji ?? '👊' : '👊'} *${attacker.name}* ataca`;

  if (!effects.dealsDamage) {
    line += ` (${effects.lines.join(', ')})`;
    tickEffects(attacker.state);
    duel.log.push(line);
    return { ok: true, line };
  }

  // Combo: golpes consecutivos del mismo jugador suman daño hasta un tope
  const consecutive = duel.lastAttacker === side ? duel.consecutiveHits + 1 : 1;
  const comboBonus = consecutive >= PVP.DUEL_COMBO.MIN_HITS ? Math.min(PVP.DUEL_COMBO.MAX, consecutive * PVP.DUEL_COMBO.PER_HIT) : 0;
  duel.lastAttacker = side;
  duel.consecutiveHits = consecutive;

  if (consumeEvasion(defender.state)) {
    line += ` 💨 *${defender.name}* esquivó`;
    tickEffects(attacker.state);
    duel.log.push(line);
    return { ok: true, line };
  }

  const attack = Math.floor(effectiveAttack(attacker.stats.attack, attacker.state) * (1 + attacker.rank.pvpDamageBonus / 200));
  const defense = Math.floor(effectiveDefense(defender.stats.defense, defender.state) * (1 + defender.rank.pvpDefenseBonus / 100));
  const skillMultiplier = skill ? (PVP_SKILL_MULTIPLIERS[skill.id] ?? skill.effect.damageMultiplier ?? 1) : 1;
  const multiplier = PVP.DAMAGE_MULTIPLIER * skillMultiplier * (1 + comboBonus) * pvpDamageMultiplier(now);
  // El crítico es menos frecuente en PvP para que los duelos no se decidan en un golpe
  const critChance = Math.floor((attacker.stats.critChance + attacker.rank.critBonus) * 0.7);
  const hit = calculateDamage(attack, defense, critChance, multiplier);

  let damage = hit.damage;
  let blocked = false;
  if (defender.state.blocking) {
    damage = Math.max(1, Math.floor(damage * PVP.BLOCK_REDUCTION));
    defender.state.blocking = false;
    blocked = true;
  }
  defender.health = Math.max(0, defender.health - damage);

  if (skill?.effect.heal) {
    const heal = Math.floor(damage * (skill.effect.heal / 100));
    attacker.health = Math.min(attacker.maxHealth, attacker.health + heal);
    line += ` +${heal}❤️`;
  }
  if (blocked) line += ' 🛡️BLOQUEADO';
  if (hit.isCrit) line += ' 💥CRIT';
  if (consecutive >= PVP.DUEL_COMBO.MIN_HITS) line += ` 🔥x${consecutive}`;
  line += ` → *${damage}*`;
  if (effects.lines.length > 0) line += ` (${effects.lines.join(', ')})`;

  tickEffects(attacker.state);
  duel.log.push(line);

  if (defender.health <= 0) {
    duel.finished = true;
    return { ok: true, line, winner: side };
  }
  return { ok: true, line };
}

// ==================== CIERRE ====================

export type DuelEndReason = 'victory' | 'surrender' | 'timeout' | 'draw' | 'refund';

export interface SettleResult {
  winner: Side | null;
  reason: DuelEndReason;
  message: string;
  finalHealth: Record<Side, number>;
}

function realHealthAfter(player: DuelPlayer): number {
  if (player.health <= 0) return 0;
  return Math.max(1, Math.min(player.realMaxHealth, Math.floor(player.health / PVP.HEALTH_MULTIPLIER)));
}

/**
 * Cierra el duelo: libera a los jugadores, reparte o devuelve el pot, persiste la
 * vida proporcional, maná y energía, cobra el IMSS solo a quien llegó a 0 y da
 * la XP al ganador. Devuelve el mensaje final.
 */
export function settleDuel(db: Database, duel: ActiveDuel, winner: Side | null, reason: DuelEndReason, now: number = Date.now()): SettleResult {
  duel.finished = true;
  if (duel.timer) clearTimeout(duel.timer);
  duel.timer = null;
  activeDuels.delete(duel.groupJid);
  for (const side of ['challenger', 'target'] as Side[]) clearBusy(duel.players[side].jid);

  const finalHealth: Record<Side, number> = { challenger: 0, target: 0 };
  const deathMessages: string[] = [];

  for (const side of ['challenger', 'target'] as Side[]) {
    const player = duel.players[side];
    const user = db.getUser(player.jid);
    const real = realHealthAfter(player);
    finalHealth[side] = real;
    const stats = { ...user.combatStats };
    if (winner === side) stats.pvpWins++;
    else if (winner !== null) stats.pvpLosses++;

    db.updateUser(player.jid, {
      health: real,
      mana: Math.max(0, Math.min(player.mana, player.maxMana)),
      stamina: Math.max(0, Math.min(player.stamina, player.maxStamina)),
      lastDuel: now,
      combatStats: stats
    });

    if (real <= 0) deathMessages.push(handlePlayerDeath(db, player.jid, player.name, now).message);
  }

  const refund = winner === null;
  if (duel.bet > 0) {
    if (refund) {
      for (const side of ['challenger', 'target'] as Side[]) {
        const user = db.getUser(duel.players[side].jid);
        db.updateUser(duel.players[side].jid, { money: user.money + duel.bet });
      }
    } else {
      const user = db.getUser(duel.players[winner].jid);
      db.updateUser(duel.players[winner].jid, { money: user.money + duel.pot });
    }
  }

  let message = `⚔️ *¡DUELO FINALIZADO!*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (winner === null) {
    message += reason === 'refund'
      ? `😴 Nadie actuó en ${msToTime(PVP.DUEL_TIMEOUT)}. El duelo se cancela${duel.bet > 0 ? ' y la apuesta se devuelve' : ''}.\n`
      : `🤝 *¡EMPATE!* Ambos quedaron con la misma vida${duel.bet > 0 ? '; la apuesta se devuelve' : ''}.\n`;
  } else {
    const winP = duel.players[winner];
    const loseP = duel.players[opposite(winner)];
    const reasonText = reason === 'surrender' ? `🏳️ *${loseP.name}* se rindió ante *${winP.name}*!`
      : reason === 'timeout' ? `⏰ El duelo expiró. *${winP.name}* gana por más vida restante!`
      : pickRandom(VICTORY_MESSAGES).replace('{winner}', winP.name).replace('{loser}', loseP.name);
    message += `${reasonText}\n\n`;

    const durationBonus = Math.min(PVP.DUEL_EXP.MAX_DURATION_BONUS, Math.floor((now - duel.startTime) / 5000) * PVP.DUEL_EXP.PER_5S);
    const exp = PVP.DUEL_EXP.BASE + loseP.level * PVP.DUEL_EXP.PER_LOSER_LEVEL + durationBonus + randomInt(0, PVP.DUEL_EXP.RANDOM_MAX);
    const rewards = grantCombatRewards(db, winP.jid, { exp, money: 0 }, now);
    const winnerUser = db.getUser(winP.jid);
    const petLeveled = addPetExp(winnerUser.pet, PET_EXP_PER_DUEL);
    db.updateUser(winP.jid, { pet: winnerUser.pet });

    if (duel.log.length > 0) message += `📜 *Registro de combate:*\n${duel.log.slice(-6).map(l => `   ${l}`).join('\n')}\n\n`;
    message += `🏆 *${winP.name}* gana:\n   ${EMOJI.exp} +${formatNumber(rewards.exp)} XP\n`;
    if (duel.bet > 0) message += `   ${EMOJI.coin} +${formatNumber(duel.pot)} monedas (apuesta)\n`;
    if (rewards.lines.length > 0) message += `\n🎮 *Bonificaciones:*\n${rewards.lines.map(l => `   ${l}`).join('\n')}\n`;
    if (petLeveled && winnerUser.pet) message += `\n🐾 ¡La mascota *${winnerUser.pet.name}* subió al nivel ${winnerUser.pet.level}!\n`;
  }

  message += `\n❤️ *Salud final (real):*\n`;
  message += `   ${duel.players.challenger.name}: *${Math.max(1, finalHealth.challenger)}* HP\n`;
  message += `   ${duel.players.target.name}: *${Math.max(1, finalHealth.target)}* HP\n`;
  for (const death of deathMessages) message += death + '\n';
  message += `\n💡 _Usa pociones para recuperar vida_`;

  return { winner, reason, message, finalHealth };
}

/** Al agotarse el tiempo: sin acciones se devuelve todo; si no, gana quien tenga más vida */
export function resolveTimeout(duel: ActiveDuel): { winner: Side | null; reason: DuelEndReason } {
  if (duel.totalActions === 0) return { winner: null, reason: 'refund' };
  const c = duel.players.challenger.health / duel.players.challenger.maxHealth;
  const t = duel.players.target.health / duel.players.target.maxHealth;
  if (c === t) return { winner: null, reason: 'draw' };
  return { winner: c > t ? 'challenger' : 'target', reason: 'timeout' };
}

// ==================== TEXTOS ====================

function skillStatusList(player: DuelPlayer, now: number, detailed: boolean): string {
  const skills = classSkills(player.playerClass);
  if (skills.length === 0) return '   _Sin clase: usa /clase para elegir una_\n';
  let text = '';
  for (const skill of skills) {
    const left = skillCooldownLeft(player, skill, now);
    const hasResources = player.mana >= skill.manaCost && player.stamina >= skill.staminaCost;
    const aliases = Object.entries(SKILL_ALIASES).filter(([a, id]) => id === skill.id && a.length <= 2).map(([a]) => a);
    const aliasText = aliases.length ? ` (${aliases.join('/')})` : '';
    const mark = left > 0 ? `⏳${Math.ceil(left / 1000)}s` : hasResources ? '✅' : '❌';
    text += `   ${skill.emoji} *${skill.name}*${aliasText} ${mark}\n`;
    if (detailed) text += `      ${skill.description} · 💙${skill.manaCost} ⚡${skill.staminaCost}\n`;
  }
  return text;
}

export function formatDuelStatus(duel: ActiveDuel, now: number = Date.now()): string {
  const bar = (p: DuelPlayer) => {
    const filled = Math.min(10, Math.max(0, Math.floor((p.health / p.maxHealth) * 10)));
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  };
  const block = (p: DuelPlayer, icon: string) => {
    const weapon = p.weaponId ? ITEMS[p.weaponId] : null;
    const effects = p.state.effects.map(e =>
      e.type === 'attackUp' ? `⚔️+${e.value}%` : e.type === 'defenseUp' ? `🛡️+${e.value}%` :
      e.type === 'defenseDown' ? `🪤-${e.value}%` : '💨').join(' ');
    let text = `${icon} *${p.name}*${p.state.blocking ? ' 🛡️' : ''}${effects ? ` ${effects}` : ''}\n`;
    text += `   [${bar(p)}] ${p.health}/${p.maxHealth}\n`;
    text += `   💙 ${p.mana}/${p.maxMana} | ⚡ ${p.stamina}/${p.maxStamina}\n`;
    if (weapon) text += `   ${weapon.emoji} ${weapon.name}\n`;
    text += skillStatusList(p, now, false);
    return text;
  };

  let msg = `⚔️ *DUELO*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += block(duel.players.challenger, '🗡️') + '\n';
  msg += block(duel.players.target, '🛡️') + '\n';

  if (duel.consecutiveHits >= PVP.DUEL_COMBO.MIN_HITS && duel.lastAttacker) {
    const bonus = Math.round(Math.min(PVP.DUEL_COMBO.MAX, duel.consecutiveHits * PVP.DUEL_COMBO.PER_HIT) * 100);
    msg += `🔥 *Combo:* ${duel.players[duel.lastAttacker].name} x${duel.consecutiveHits} (+${bonus}%)\n\n`;
  }
  if (duel.log.length > 0) msg += `📜 *Acciones:*\n${duel.log.slice(-4).map(l => `   ${l}`).join('\n')}\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `*a*=atacar | *d*=bloquear | *h*=habilidad | *rendirse*\n`;
  msg += `💡 _Bloquea para romper combos y ganar maná_`;
  return msg;
}

function duelHelp(usedPrefix: string): string {
  let msg = `⚔️ *GUÍA DE DUELOS PVP*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📋 *CÓMO INICIAR*\n• *${usedPrefix}duelo @usuario [apuesta]*\n• El retado usa *${usedPrefix}aceptar* o *${usedPrefix}rechazar*\n• Nivel mínimo: ${PVP.MIN_LEVEL_PVP} | Apuesta: ${PVP.DUEL_BET.MIN}-${formatNumber(PVP.DUEL_BET.MAX)}\n\n`;
  msg += `🎮 *EN COMBATE (sin prefijo)*\n• *a* / *g* - Golpe (${PVP.DUEL_COSTS.ATTACK_STAMINA}⚡, +${PVP.DUEL_REGEN.MANA_PER_ACTION}💙)\n• *d* / *b* - Bloquear (${PVP.DUEL_COSTS.BLOCK_STAMINA}⚡, +${PVP.DUEL_REGEN.MANA_PER_BLOCK}💙, -${Math.round(PVP.BLOCK_REDUCTION * 100)}% del próximo golpe)\n• *h* - Lista de habilidades | *h [nombre]* o el alias (gb, bf, af, dp...)\n• *estado* - Ver el duelo | *rendirse* - Abandonar\n\n`;
  msg += `⚡ *SISTEMA*\n• Sin turnos: ${PVP.DUEL_ACTION_COOLDOWN / 1000}s entre acciones\n• Vida x${PVP.HEALTH_MULTIPLIER} y daño reducido para que dure\n• Combo: ${PVP.DUEL_COMBO.MIN_HITS}+ golpes seguidos suman daño (máx +${Math.round(PVP.DUEL_COMBO.MAX * 100)}%)\n• Buffs, evasión y trampas de clase funcionan\n• Tiempo máximo: ${msToTime(PVP.DUEL_TIMEOUT)} (gana quien tenga más vida; empate devuelve la apuesta)\n\n`;
  msg += `🏆 *RECOMPENSAS*\n• XP base + nivel del rival + duración\n• El ganador se lleva las dos apuestas\n• Solo paga IMSS quien llega a 0 de vida\n• Cooldown entre duelos: ${msToTime(PVP.DUEL_COOLDOWN)}`;
  return msg;
}

// ==================== PLUGINS GLOBALES ====================

function canFight(user: UserRPG, jid: string, now: number, self: boolean): string | null {
  const who = self ? 'Estás' : `*${user.name}* está`;
  if (!user.registered) return `${EMOJI.error} ${self ? 'No estás registrado' : 'Ese jugador no está registrado'} en el RPG.`;
  if (user.level < PVP.MIN_LEVEL_PVP) return `${EMOJI.error} ${self ? 'Necesitas' : `*${user.name}* necesita`} nivel *${PVP.MIN_LEVEL_PVP}* para los duelos.`;
  if (user.passiveMode && user.passiveModeUntil > now) return `🕊️ ${who} en *modo pasivo* y no puede${self ? 's' : ''} pelear.`;
  if (user.health < PVP.MIN_HEALTH_DUEL) return `${EMOJI.error} ${who} muy herido para un duelo (mín. ${PVP.MIN_HEALTH_DUEL} HP).`;
  const busy = getBusy(jid);
  if (busy) return `${EMOJI.error} ${busyMessage(busy, self ? 'Tú' : user.name)}`;
  return null;
}

function cancelPending(challengerJid: string): void {
  const pending = pendingDuels.get(challengerJid);
  if (pending) clearTimeout(pending.timer);
  pendingDuels.delete(challengerJid);
}

export const dueloPlugin: PluginHandler = {
  command: ['duelo', 'duel', 'pvp', 'retar'],
  tags: ['rpg'],
  help: [
    'duelo @usuario [apuesta] - Desafía a un jugador',
    'duelo ayuda - Guía completa de duelos'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const challenger = db.getUser(m.sender);
    const now = Date.now();

    if (args[0] && ['-help', 'help', '-h', 'ayuda', '-ayuda', '?'].includes(args[0].toLowerCase())) {
      await m.reply(duelHelp(usedPrefix));
      return;
    }
    checkExpiredModes(now);

    if (activeDuels.has(m.chat)) {
      await m.reply(`${EMOJI.error} Ya hay un duelo en curso en este grupo. Espera a que termine.`);
      return;
    }
    const selfCheck = canFight(challenger, m.sender, now, true);
    if (selfCheck) {
      await m.reply(selfCheck);
      return;
    }
    const lastDuel = challenger.lastDuel || 0;
    if (now - lastDuel < PVP.DUEL_COOLDOWN) {
      await m.reply(`${EMOJI.time} Acabas de pelear. Espera *${msToTime(PVP.DUEL_COOLDOWN - (now - lastDuel))}* para otro duelo.`);
      return;
    }

    const targetJid = getTargetUser({ mentionedJid: m.mentionedJid, quoted: m.quoted, chat: m.chat, sender: m.sender }, { args, allowSelf: true });
    if (!targetJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres retar?\n\n📝 *Uso:* ${usedPrefix}duelo @usuario [apuesta]\n` +
        `💰 La apuesta es opcional (${PVP.DUEL_BET.MIN}-${formatNumber(PVP.DUEL_BET.MAX)})\n\n💡 *${usedPrefix}duelo ayuda* para la guía completa`
      );
      return;
    }
    if (targetJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes retarte a ti mismo...`);
      return;
    }
    const target = db.getUser(targetJid);
    const targetCheck = canFight(target, targetJid, now, false);
    if (targetCheck) {
      await m.reply(targetCheck);
      return;
    }

    let bet = 0;
    const betArg = args.find(a => /^\d+$/.test(a));
    if (betArg) {
      bet = Math.min(PVP.DUEL_BET.MAX, Math.max(PVP.DUEL_BET.MIN, parseInt(betArg, 10)));
      if (challenger.money < bet) {
        await m.reply(`${EMOJI.error} No tienes suficiente dinero para esa apuesta (tienes ${formatNumber(challenger.money)}).`);
        return;
      }
      if (target.money < bet) {
        await m.reply(`${EMOJI.error} *${target.name}* no tiene suficiente dinero para esa apuesta.`);
        return;
      }
    }

    cancelPending(m.sender);
    const timer = setTimeout(() => {
      if (pendingDuels.get(m.sender)?.timestamp === now) pendingDuels.delete(m.sender);
    }, PVP.DUEL_TIMEOUT);
    timer.unref();
    pendingDuels.set(m.sender, { challengerJid: m.sender, targetJid, groupJid: m.chat, bet, timestamp: now, timer });

    const card = (user: UserRPG, icon: string) => {
      const stats = playerStats(user);
      const classInfo = user.playerClass ? CLASSES[user.playerClass] : null;
      const weapon = user.equipment.weapon ? ITEMS[user.equipment.weapon] : null;
      const armor = user.equipment.armor ? ITEMS[user.equipment.armor] : null;
      let text = `${icon} *${user.name}* (Nv.${user.level}) ${getRoleByLevel(user.level)}\n   ❤️ ${user.health}/${stats.maxHealth} | ⚔️ ${stats.attack} | 🛡️ ${stats.defense}\n`;
      if (classInfo) text += `   ${classInfo.emoji} ${classInfo.name}\n`;
      if (weapon) text += `   ${weapon.emoji} ${weapon.name}\n`;
      if (armor) text += `   ${armor.emoji} ${armor.name}\n`;
      return text;
    };

    let msg = `⚔️ *¡DESAFÍO DE DUELO!*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += card(challenger, '🗡️') + `\n   ⚡ VS ⚡\n\n` + card(target, '🛡️') + '\n';
    if (bet > 0) msg += `💰 *Apuesta:* ${formatNumber(bet)} monedas (se descuenta a ambos al aceptar)\n\n`;
    msg += `@${targetJid.split('@')[0]}, escribe *${usedPrefix}aceptar* para pelear o *${usedPrefix}rechazar* para declinar.\n\n`;
    msg += `⏰ _El desafío expira en ${msToTime(PVP.DUEL_TIMEOUT)}._`;

    await m.reply(msg);
    await m.react('⚔️');
  }
};

export const aceptarPlugin: PluginHandler = {
  command: ['aceptar', 'accept'],
  tags: ['rpg'],
  help: ['aceptar - Acepta un desafío de duelo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const now = Date.now();

    const pending = [...pendingDuels.values()].find(p => p.targetJid === m.sender && p.groupJid === m.chat && now - p.timestamp < PVP.DUEL_TIMEOUT);
    if (!pending) {
      await m.reply(`${EMOJI.error} No tienes ningún desafío pendiente en este grupo.`);
      return;
    }
    if (activeDuels.has(m.chat)) {
      await m.reply(`${EMOJI.error} Ya hay un duelo en curso.`);
      return;
    }

    const accepter = db.getUser(m.sender);
    const challenger = db.getUser(pending.challengerJid);
    const selfCheck = canFight(accepter, m.sender, now, true);
    if (selfCheck) {
      await m.reply(selfCheck);
      return;
    }
    const otherCheck = canFight(challenger, pending.challengerJid, now, false);
    if (otherCheck) {
      cancelPending(pending.challengerJid);
      await m.reply(`${otherCheck}\n_El desafío se canceló._`);
      return;
    }
    if (pending.bet > 0 && (accepter.money < pending.bet || challenger.money < pending.bet)) {
      cancelPending(pending.challengerJid);
      await m.reply(`${EMOJI.error} Fondos insuficientes para la apuesta. El desafío se canceló.`);
      return;
    }

    cancelPending(pending.challengerJid);
    setBusy(pending.challengerJid, 'duel');
    setBusy(m.sender, 'duel');

    // Depósito: la apuesta sale de ambos ahora y vuelve al ganador (o a los dos si no hay)
    if (pending.bet > 0) {
      db.updateUser(pending.challengerJid, { money: challenger.money - pending.bet });
      db.updateUser(m.sender, { money: accepter.money - pending.bet });
    }

    const duel = createDuel({ jid: pending.challengerJid, user: challenger }, { jid: m.sender, user: accepter }, m.chat, pending.bet, now);
    activeDuels.set(m.chat, duel);
    duel.timer = setTimeout(async () => {
      const current = activeDuels.get(m.chat);
      if (!current || current.startTime !== now || current.finished) return;
      const outcome = resolveTimeout(current);
      try {
        const result = settleDuel(getDatabase(), current, outcome.winner, outcome.reason);
        await m.reply(result.message);
      } catch (error) {
        log.error('timeout de duelo:', error);
      }
    }, PVP.DUEL_TIMEOUT);
    duel.timer.unref();

    await m.react('⚔️');
    await m.reply(
      `⚔️ *¡DUELO INICIADO!*\n━━━━━━━━━━━━━━━━━━━━━\n\n🗡️ *${challenger.name}* VS 🛡️ *${accepter.name}*\n\n` +
      `⚡ Escribe sin prefijo: *a* atacar · *d* bloquear · *h* habilidades · *rendirse*\n` +
      (pending.bet > 0 ? `💰 En juego: *${formatNumber(duel.pot)}* monedas\n` : '') +
      `⏰ Tiempo máximo: ${msToTime(PVP.DUEL_TIMEOUT)}\n\n💡 _¡Usa tus recursos sabiamente!_`
    );
    await m.reply(formatDuelStatus(duel, now));
  }
};

export const rechazarPlugin: PluginHandler = {
  command: ['rechazar', 'decline', 'negar'],
  tags: ['rpg'],
  help: ['rechazar - Rechaza un desafío de duelo'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const pending = [...pendingDuels.values()].find(p => p.targetJid === m.sender && p.groupJid === m.chat);
    if (!pending) {
      await m.reply(`${EMOJI.info} No tienes desafíos pendientes en este grupo.`);
      return;
    }
    cancelPending(pending.challengerJid);
    const user = db.getUser(m.sender);
    const challenger = db.getUser(pending.challengerJid);
    await m.reply(`${EMOJI.error} *${user.name}* rechazó el duelo de *${challenger.name}*.\n\n💔 _Quizás otro día..._`);
    await m.react('❌');
  }
};

// ==================== PLUGINS DEL CONTEXTO ====================

function duelFor(m: SerializedMessage): { duel: ActiveDuel; side: Side } | null {
  const duel = activeDuels.get(m.chat);
  if (!duel || duel.finished) return null;
  const side = sideOf(duel, m.sender);
  return side ? { duel, side } : null;
}

async function runAction(ctx: MessageContext, action: DuelAction): Promise<void> {
  const { m } = ctx;
  const found = duelFor(m);
  if (!found) return;
  const { duel, side } = found;
  const now = Date.now();

  const result = performDuelAction(duel, side, action, now);
  if (!result.ok) {
    if (result.error) await m.reply(result.error);
    return;
  }
  if (result.winner) {
    const settled = settleDuel(getDatabase(), duel, result.winner, 'victory', now);
    await m.reply(settled.message);
    return;
  }
  if (action.kind === 'block') {
    await m.reply(`🛡️ *${duel.players[side].name}* levanta su guardia!\n_El próximo golpe recibido hará ${Math.round(PVP.BLOCK_REDUCTION * 100)}% menos de daño_`);
    return;
  }
  await m.reply(formatDuelStatus(duel, now));
}

/** Busca una habilidad de la clase por alias, id o nombre (sin tildes) */
export function findSkill(text: string, playerClass: PlayerClass | null): Skill | null {
  const skills = classSkills(playerClass);
  if (skills.length === 0) return null;
  const norm = normalizeText(text).replace(/[^a-z0-9]/g, '');
  if (!norm) return null;
  const alias = SKILL_ALIASES[norm];
  if (alias) return skills.find(s => s.id === alias) ?? null;
  for (const skill of skills) {
    const name = normalizeText(skill.name).replace(/[^a-z0-9]/g, '');
    const id = skill.id.replace(/_/g, '');
    if (norm === name || norm === id || name.startsWith(norm) || id.startsWith(norm)) return skill;
    if (normalizeText(skill.name).split(/\s+/).some(w => w.length >= 4 && w === norm)) return skill;
  }
  return null;
}

function buildSkillRegex(): RegExp {
  const patterns = new Set<string>(Object.keys(SKILL_ALIASES));
  for (const skill of Object.values(SKILLS)) {
    patterns.add(skill.id.replace(/_/g, ''));
    patterns.add(skill.id.replace(/_/g, '.?'));
    patterns.add(normalizeText(skill.name).replace(/\s+/g, '.?'));
    for (const word of normalizeText(skill.name).split(/\s+/)) if (word.length >= 4) patterns.add(word);
  }
  const sorted = [...patterns].filter(p => p.length >= 2).sort((a, b) => b.length - a.length);
  return new RegExp(`^(${sorted.join('|')})$`, 'i');
}

const SKILL_REGEX = buildSkillRegex();

const atacarDueloPlugin: PluginHandler = {
  command: ['a', 'atacar', 'attack', 'golpe', 'golpear', 'hit', 'g'],
  tags: ['rpg'],
  help: ['a - Golpea con tu arma en el duelo (alias: g, golpe)'],
  noPrefix: true,
  handler: (ctx) => runAction(ctx, { kind: 'attack' })
};

const bloquearDueloPlugin: PluginHandler = {
  command: ['d', 'defender', 'bloquear', 'block', 'b'],
  tags: ['rpg'],
  help: ['d - Bloquea el próximo golpe (alias: b, bloquear)'],
  noPrefix: true,
  handler: (ctx) => runAction(ctx, { kind: 'block' })
};

const poderDueloPlugin: PluginHandler = {
  command: ['h', 'habilidad', 'poder', 'skill', 'p'],
  tags: ['rpg'],
  help: ['h - Lista tus habilidades | h [nombre] - Úsala'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const found = duelFor(m);
    if (!found) return;
    const player = found.duel.players[found.side];

    if (!player.playerClass) {
      await m.reply(`${EMOJI.error} No tienes clase. Usa */clase* para elegir una.`);
      return;
    }
    const term = args.join(' ').trim();
    if (!term) {
      const classInfo = CLASSES[player.playerClass];
      await m.reply(
        `${classInfo.emoji} *Habilidades de ${classInfo.name}:*\n\n${skillStatusList(player, Date.now(), true)}\n` +
        `📝 Usa *h [nombre o alias]* o escribe el alias directamente\n✅ lista · ❌ sin recursos · ⏳ en cooldown`
      );
      return;
    }
    const skill = findSkill(term, player.playerClass);
    if (!skill) {
      await m.reply(`${EMOJI.error} No tienes una habilidad llamada "${term}". Usa *h* para ver la lista.`);
      return;
    }
    await runAction(ctx, { kind: 'skill', skill });
  }
};

const skillDetectorPlugin: PluginHandler = {
  command: SKILL_REGEX,
  tags: ['rpg'],
  help: ['Escribe el nombre o alias de tu habilidad para usarla'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const found = duelFor(m);
    if (!found) return;
    const skill = findSkill(m.text || '', found.duel.players[found.side].playerClass);
    if (!skill) return;
    await runAction(ctx, { kind: 'skill', skill });
  }
};

const rendirsePlugin: PluginHandler = {
  command: ['rendirse', 'surrender', 'abandonar', 'huir', 'salir'],
  tags: ['rpg'],
  help: ['rendirse - Abandona el duelo (el rival gana)'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const found = duelFor(m);
    if (!found) return;
    const settled = settleDuel(getDatabase(), found.duel, opposite(found.side), 'surrender');
    await m.reply(settled.message);
  }
};

const estadoDueloPlugin: PluginHandler = {
  command: ['estado', 'status', 'st'],
  tags: ['rpg'],
  help: ['estado - Ver el estado del duelo'],
  noPrefix: true,

  handler: async (ctx: MessageContext) => {
    const found = duelFor(ctx.m);
    if (!found) return;
    await ctx.m.reply(formatDuelStatus(found.duel));
  }
};

/** Acciones del duelo: solo mientras hay duelo en el chat y el remitente participa */
export const duelContext: CommandContext = {
  name: 'duelo',
  isActive: (m: SerializedMessage) => duelFor(m) !== null,
  plugins: [atacarDueloPlugin, bloquearDueloPlugin, poderDueloPlugin, rendirsePlugin, estadoDueloPlugin, skillDetectorPlugin],
  noPrefix: true
};

/** Cancela a la fuerza el duelo de un grupo devolviendo la apuesta (owner) */
export function cancelDuel(db: Database, groupJid: string): SettleResult | null {
  const duel = activeDuels.get(groupJid);
  if (!duel) return null;
  return settleDuel(db, duel, null, 'refund');
}

/**
 * @deprecated Registro global antiguo (plugins/index.ts). Las acciones viven en
 * `duelContext`; fuera de un duelo no hacen nada. Quitar cuando index.ts use
 * registerCombatContexts.
 */
export { atacarDueloPlugin, bloquearDueloPlugin, poderDueloPlugin, skillDetectorPlugin, rendirsePlugin };

export default dueloPlugin;
