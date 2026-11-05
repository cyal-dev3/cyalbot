import type { Database } from './database.js';
import { calculateDamage, calculateTotalStats, type TotalStats } from './rpg-utils.js';
import { grantExp } from './levelling.js';
import { applyGlobalModes } from './global-modes.js';
import { addLoot, lootLabel } from './rpg-inventory.js';
import { formatNumber, randomInt } from './utils.js';
import { calculateIMSSFee, PVE } from '../constants/rpg.js';
import type { Drop, Monster, Skill } from '../types/rpg.js';
import type { ActiveBuff, UserPet, UserRPG } from '../types/user.js';
import { updateQuestProgress } from '../plugins/rpg-misiones.js';
import { getPetBuff } from '../plugins/rpg-mascotas.js';

// ==================== REGISTRO DE OCUPADOS ====================

export type BusyKind = 'duel' | 'dungeon';

const busy = new Map<string, BusyKind>();

/** Marca al jugador como ocupado; false si ya lo estaba en otra actividad */
export function setBusy(jid: string, kind: BusyKind): boolean {
  const current = busy.get(jid);
  if (current && current !== kind) return false;
  busy.set(jid, kind);
  return true;
}

export function getBusy(jid: string): BusyKind | null {
  return busy.get(jid) ?? null;
}

export function clearBusy(jid: string): void {
  busy.delete(jid);
}

export function listBusy(): { jid: string; kind: BusyKind }[] {
  return [...busy.entries()].map(([jid, kind]) => ({ jid, kind }));
}

export function busyMessage(kind: BusyKind, name: string = 'Ese jugador'): string {
  return kind === 'duel'
    ? `${name} está en un duelo ahora mismo. Espera a que termine.`
    : `${name} está dentro de un dungeon ahora mismo. Espera a que termine.`;
}

// ==================== EFECTOS DE ESTADO ====================

export type StatusEffectType = 'attackUp' | 'defenseUp' | 'defenseDown' | 'evading';

export interface StatusEffect {
  type: StatusEffectType;
  /** Porcentaje (attackUp 30 = +30 %); para evading se ignora */
  value: number;
  /** Acciones propias que le quedan al efecto */
  remaining: number;
}

export interface CombatantState {
  effects: StatusEffect[];
  /** Bloqueo preparado: el próximo golpe recibido se reduce */
  blocking: boolean;
}

export function createCombatState(): CombatantState {
  return { effects: [], blocking: false };
}

function effectValue(state: CombatantState, type: StatusEffectType): number {
  return state.effects.filter(e => e.type === type && e.remaining > 0).reduce((sum, e) => sum + e.value, 0);
}

export function effectiveAttack(base: number, state: CombatantState): number {
  return Math.max(1, Math.floor(base * (1 + effectValue(state, 'attackUp') / 100)));
}

export function effectiveDefense(base: number, state: CombatantState): number {
  const factor = 1 + effectValue(state, 'defenseUp') / 100 - effectValue(state, 'defenseDown') / 100;
  return Math.max(0, Math.floor(base * Math.max(0, factor)));
}

export function isEvading(state: CombatantState): boolean {
  return state.effects.some(e => e.type === 'evading' && e.remaining > 0);
}

/** Si el defensor tenía evasión activa la consume y devuelve true */
export function consumeEvasion(state: CombatantState): boolean {
  const index = state.effects.findIndex(e => e.type === 'evading' && e.remaining > 0);
  if (index === -1) return false;
  state.effects.splice(index, 1);
  return true;
}

/** Descuenta una acción a los efectos del combatiente y elimina los agotados; devuelve los que expiraron */
export function tickEffects(state: CombatantState): StatusEffectType[] {
  const expired: StatusEffectType[] = [];
  for (const effect of state.effects) {
    // La evasión dura hasta el próximo golpe recibido, no por acciones
    if (effect.type === 'evading') continue;
    effect.remaining--;
    if (effect.remaining <= 0) expired.push(effect.type);
  }
  state.effects = state.effects.filter(e => e.remaining > 0);
  return expired;
}

function upsertEffect(state: CombatantState, effect: StatusEffect): void {
  const existing = state.effects.find(e => e.type === effect.type);
  if (existing) {
    existing.value = Math.max(existing.value, effect.value);
    existing.remaining = Math.max(existing.remaining, effect.remaining);
  } else {
    state.effects.push(effect);
  }
}

export interface SkillEffectResult {
  /** Líneas para el log del combate */
  lines: string[];
  /** true si la habilidad hace daño directo (damageMultiplier) */
  dealsDamage: boolean;
}

/**
 * Aplica los efectos no ofensivos de una habilidad: buffs de ataque/defensa al
 * atacante, evasión del próximo golpe y debuff de defensa al defensor. El daño
 * directo lo resuelve el combate con skill.effect.damageMultiplier.
 */
export function applySkillEffect(skill: Skill, attacker: CombatantState, defender: CombatantState): SkillEffectResult {
  const lines: string[] = [];
  const { buff, debuff } = skill.effect;

  if (buff) {
    if (buff.stat === 'attack') {
      upsertEffect(attacker, { type: 'attackUp', value: buff.value, remaining: buff.duration });
      lines.push(`⚔️ +${buff.value}% ataque por ${buff.duration} acciones`);
    } else if (buff.stat === 'defense') {
      upsertEffect(attacker, { type: 'defenseUp', value: buff.value, remaining: buff.duration });
      lines.push(`🛡️ +${buff.value}% defensa por ${buff.duration} acciones`);
    } else if (buff.stat === 'evasion') {
      upsertEffect(attacker, { type: 'evading', value: buff.value, remaining: Math.max(1, buff.duration) });
      lines.push('💨 esquivará el próximo golpe');
    }
  }

  if (debuff && debuff.stat === 'defense') {
    upsertEffect(defender, { type: 'defenseDown', value: debuff.value, remaining: debuff.duration });
    lines.push(`🪤 rival con -${debuff.value}% defensa por ${debuff.duration} acciones`);
  }

  return { lines, dealsDamage: Boolean(skill.effect.damageMultiplier) };
}

// ==================== BUFFS DEL USUARIO ====================

/** expiresAt de los buffs permanentes (sobrevive al JSON, a diferencia de Infinity) */
export const PERMANENT_BUFF = Number.MAX_SAFE_INTEGER;

/** Tipo de buff que types/user.ts todavía no declara; se guarda con cast */
export const DROP_LUCK_BUFF = 'dropLuck' as ActiveBuff['type'];

export function activeBuffs(user: UserRPG, now: number = Date.now()): ActiveBuff[] {
  if (!Array.isArray(user.activeBuffs)) return [];
  return user.activeBuffs.filter(b => b && b.expiresAt > now);
}

/** Elimina buffs caducados; devuelve true si cambió la lista */
export function pruneExpiredBuffs(user: UserRPG, now: number = Date.now()): boolean {
  if (!Array.isArray(user.activeBuffs)) {
    user.activeBuffs = [];
    return true;
  }
  const before = user.activeBuffs.length;
  user.activeBuffs = user.activeBuffs.filter(b => b && b.expiresAt > now);
  return user.activeBuffs.length !== before;
}

/** Multiplicador de XP por buffs (elixir, boost, runas permanentes); se multiplican entre sí */
export function getExpMultiplier(user: UserRPG, now: number = Date.now()): number {
  let multiplier = 1;
  for (const buff of activeBuffs(user, now)) {
    if (buff.type === 'expBoost' && Number.isFinite(buff.value) && buff.value > 0) multiplier *= buff.value;
  }
  return multiplier;
}

/** Puntos porcentuales extra de probabilidad de drop por buffs de suerte */
export function getDropLuck(user: UserRPG, now: number = Date.now()): number {
  return activeBuffs(user, now)
    .filter(b => b.type === DROP_LUCK_BUFF)
    .reduce((sum, b) => sum + (Number.isFinite(b.value) ? b.value : 0), 0);
}

export interface RollDropsOptions {
  /** Puntos porcentuales extra (20 = +20 % relativo sobre cada chance) */
  luckBonus?: number;
  /** Multiplicador plano de la probabilidad (dungeons: 0.5) */
  chanceMultiplier?: number;
  random?: () => number;
}

export function rollDrops(drops: readonly Drop[], opts: RollDropsOptions = {}): string[] {
  const random = opts.random ?? Math.random;
  const luck = 1 + Math.max(0, opts.luckBonus ?? 0) / 100;
  const factor = opts.chanceMultiplier ?? 1;
  const out: string[] = [];
  for (const drop of drops) {
    const chance = Math.min(1, drop.chance * factor * luck);
    if (random() < chance) out.push(drop.itemId);
  }
  return out;
}

// ==================== COMBATIENTES ====================

export interface Fighter {
  name: string;
  attack: number;
  defense: number;
  critChance: number;
  health: number;
}

/** Stats totales con el buff de la mascota aplicado */
export function statsWithPet(stats: TotalStats, pet: UserPet | undefined | null): TotalStats {
  const buff = getPetBuff(pet);
  if (!buff.attackMul && !buff.defenseMul) return stats;
  return {
    ...stats,
    attack: Math.round(stats.attack * (1 + buff.attackMul)),
    defense: Math.round(stats.defense * (1 + buff.defenseMul))
  };
}

export function playerStats(user: UserRPG): TotalStats {
  return statsWithPet(calculateTotalStats(user), user.pet);
}

export function fighterFromUser(user: UserRPG, health: number = user.health): Fighter {
  const stats = playerStats(user);
  return { name: user.name || 'Aventurero', attack: stats.attack, defense: stats.defense, critChance: stats.critChance, health };
}

export function fighterFromMonster(monster: Monster, boss: boolean = false): Fighter {
  const mult = PVE.DUNGEON.BOSS_STATS_MULTIPLIER;
  return {
    name: monster.name,
    attack: boss ? Math.floor(monster.attack * mult.ATTACK) : monster.attack,
    defense: boss ? Math.floor(monster.defense * mult.DEFENSE) : monster.defense,
    critChance: PVE.MONSTER_CRIT_CHANCE,
    health: boss ? Math.floor(monster.health * mult.HEALTH) : monster.health
  };
}

export type FightOutcome = 'won' | 'lost' | 'draw';

export interface FightOptions {
  /** Turnos máximos; al agotarse el resultado es 'draw' */
  maxTurns?: number;
  /** Multiplicadores de daño de cada bando (modos globales, habilidades) */
  attackerMultiplier?: number;
  defenderMultiplier?: number;
  /** Líneas de log que se conservan (las últimas) */
  keepLog?: number;
}

export interface FightResult {
  result: FightOutcome;
  damageDealt: number;
  damageTaken: number;
  turns: number;
  attackerHealth: number;
  defenderHealth: number;
  log: string[];
}

/**
 * Combate automático por turnos: `attacker` golpea primero cada turno. Usa
 * calculateDamage de rpg-utils (Math.random), así que en tests se controla
 * sustituyendo Math.random.
 */
export function simulateFight(attacker: Fighter, defender: Fighter, opts: FightOptions = {}): FightResult {
  const maxTurns = opts.maxTurns ?? PVE.MAX_TURNS;
  let aHealth = attacker.health;
  let dHealth = defender.health;
  let turns = 0;
  let damageDealt = 0;
  let damageTaken = 0;
  const log: string[] = [];

  while (aHealth > 0 && dHealth > 0 && turns < maxTurns) {
    turns++;

    const hit = calculateDamage(attacker.attack, defender.defense, attacker.critChance, opts.attackerMultiplier ?? 1);
    dHealth -= hit.damage;
    damageDealt += hit.damage;
    log.push(hit.isCrit
      ? `⚡ *CRÍTICO!* ${attacker.name} causó ${hit.damage} de daño`
      : `⚔️ ${attacker.name} causó ${hit.damage} de daño`);
    if (dHealth <= 0) break;

    const counter = calculateDamage(defender.attack, attacker.defense, defender.critChance, opts.defenderMultiplier ?? 1);
    aHealth -= counter.damage;
    damageTaken += counter.damage;
    log.push(counter.isCrit
      ? `💥 *${defender.name} CRÍTICO!* te causó ${counter.damage} de daño`
      : `👹 ${defender.name} te causó ${counter.damage} de daño`);
  }

  const result: FightOutcome = dHealth <= 0 ? 'won' : aHealth <= 0 ? 'lost' : 'draw';
  const keep = opts.keepLog ?? 6;

  return {
    result,
    damageDealt,
    damageTaken,
    turns,
    attackerHealth: Math.max(0, aHealth),
    defenderHealth: Math.max(0, dHealth),
    log: log.slice(-keep)
  };
}

// ==================== MUERTE E IMSS ====================

export interface DeathResult {
  fee: number;
  paid: boolean;
  insured: boolean;
  debt: number;
  tierLabel: string;
  message: string;
}

function imssMessage(result: Omit<DeathResult, 'message'>, name: string): string {
  let msg = `\n🏥 *CUOTA DEL IMSS*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 Paciente: *${name}*\n`;

  if (result.insured) {
    msg += `📜 *SEGURO DE VIDA PREMIUM ACTIVO*\n\n`;
    msg += `✅ *Cuota cubierta por tu seguro*\n`;
    msg += `💵 Costo: *$0* (seguro activo)\n`;
    msg += `_Tu seguro de vida te ha salvado de la deuda_`;
    return msg;
  }

  msg += `💊 Urgencia: ${result.tierLabel}\n`;
  msg += `💵 Cuota médica: *$${formatNumber(result.fee)}*\n\n`;
  if (result.paid) {
    msg += `✅ *Cuota pagada exitosamente*\n`;
    msg += `_Gracias por confiar en el IMSS_`;
  } else {
    msg += `❌ *No tienes suficiente dinero*\n`;
    msg += `📋 Deuda total con IMSS: *$${formatNumber(result.debt)}*\n`;
    msg += `⚠️ _Paga tu deuda con /pagardeuda_`;
  }
  return msg;
}

/**
 * El jugador llegó a 0 de vida: cobra la cuota del IMSS (o la cubre el seguro),
 * anota la deuda si no puede pagar y lo revive con 1 de vida. Devuelve el
 * mensaje listo para pegar a la respuesta.
 */
export function handlePlayerDeath(db: Database, jid: string, name?: string, now: number = Date.now()): DeathResult {
  const user = db.getUser(jid);
  const displayName = name || user.name || 'Aventurero';

  if (user.seguroVida && user.seguroVida > now) {
    const partial = { fee: 0, paid: true, insured: true, debt: user.debt, tierLabel: '📜 Seguro Premium' };
    db.updateUser(jid, { health: 1 });
    return { ...partial, message: imssMessage(partial, displayName) };
  }

  const fee = calculateIMSSFee(randomInt);
  const tierLabel = `${fee.emoji} ${fee.name}`;
  const updates: Partial<UserRPG> = { health: 1 };
  let paid = true;
  let debt = user.debt;

  if (user.money >= fee.amount) {
    updates.money = user.money - fee.amount;
  } else {
    paid = false;
    debt = user.debt + (fee.amount - user.money);
    updates.money = 0;
    updates.debt = debt;
    // El interés de rpg-economia cuenta desde la creación de la deuda
    if (!user.debtCreatedAt) updates.debtCreatedAt = now;
  }

  db.updateUser(jid, updates);
  const partial = { fee: fee.amount, paid, insured: false, debt, tierLabel };
  return { ...partial, message: imssMessage(partial, displayName) };
}

// ==================== RECOMPENSAS ====================

export interface CombatRewardInput {
  exp: number;
  money: number;
  /** Ids de items o materiales (van al inventario o a forgeMaterials) */
  items?: string[];
  /** Progreso de misión que concede este combate */
  quest?: { objective: 'combat' | 'dungeon'; amount: number };
}

export interface CombatRewardResult {
  /** XP efectivamente sumada (modos globales y buffs incluidos) */
  exp: number;
  money: number;
  leveledUp: boolean;
  from: number;
  to: number;
  /** Multiplicador de XP por buffs del jugador */
  expMultiplier: number;
  /** Líneas de bonificación para el mensaje */
  lines: string[];
  /** Botín entregado (etiquetas con emoji) */
  items: string[];
  /** Botín que no cupo en el inventario */
  lost: string[];
}

/**
 * Entrega XP, dinero y botín de un combate: aplica modos globales, buffs de XP,
 * sube de nivel con grantExp, guarda y actualiza misiones (earn y la indicada).
 */
export function grantCombatRewards(db: Database, jid: string, input: CombatRewardInput, now: number = Date.now()): CombatRewardResult {
  const user = db.getUser(jid);
  pruneExpiredBuffs(user, now);

  const modes = applyGlobalModes({ exp: input.exp, money: input.money }, now);
  const expMultiplier = getExpMultiplier(user, now);
  const grant = grantExp(user, modes.exp, { multiplier: expMultiplier });

  user.money = Math.max(0, (user.money || 0) + modes.money);
  user.totalEarned = (user.totalEarned || 0) + modes.money;

  const items: string[] = [];
  const lost: string[] = [];
  for (const id of input.items ?? []) {
    const kind = addLoot(user, id, 1);
    if (kind === 'item' || kind === 'material') items.push(lootLabel(id));
    else lost.push(lootLabel(id));
  }

  db.updateUser(jid, {
    exp: user.exp,
    level: user.level,
    maxHealth: user.maxHealth,
    maxStamina: user.maxStamina,
    maxMana: user.maxMana,
    health: user.health,
    stamina: user.stamina,
    mana: user.mana,
    money: user.money,
    totalEarned: user.totalEarned,
    inventory: user.inventory,
    forgeMaterials: user.forgeMaterials,
    activeBuffs: user.activeBuffs
  });

  const lines = [...modes.lines];
  if (expMultiplier > 1) lines.push(`✨ Buff de XP x${Number(expMultiplier.toFixed(2))}`);
  if (grant.leveledUp) lines.push(`📈 ¡Subiste al nivel *${grant.to}*!`);

  if (modes.money > 0) updateQuestProgress(db, jid, 'earn', modes.money);
  if (input.quest && input.quest.amount > 0) updateQuestProgress(db, jid, input.quest.objective, input.quest.amount);

  return {
    exp: grant.gained,
    money: modes.money,
    leveledUp: grant.leveledUp,
    from: grant.from,
    to: grant.to,
    expMultiplier,
    lines,
    items,
    lost
  };
}
