import { CONFIG } from '../config.js';
import { DEFAULT_USER, type UserRPG } from '../types/user.js';
import { calculateTotalStats } from './rpg-utils.js';

/**
 * Factor de crecimiento exponencial: (π/e)^φ * e * 0.75, con φ = 1.618
 */
export const GROWTH = Math.pow(Math.PI / Math.E, 1.618) * Math.E * 0.75;

/** Multiplicador global de XP; ajusta la dificultad de subir de nivel */
export const MULTIPLIER = 99;

export interface XPRange {
  /** XP mínimo para este nivel */
  min: number;
  /** XP máximo para este nivel */
  max: number;
  /** XP necesario para pasar al siguiente nivel */
  xp: number;
}

export function xpRange(level: number, multiplier: number = MULTIPLIER): XPRange {
  if (level < 0) throw new TypeError('El nivel no puede ser negativo');

  level = Math.floor(level);
  const min = level === 0 ? 0 : Math.round(Math.pow(level, GROWTH) * multiplier) + 1;
  const max = Math.round(Math.pow(level + 1, GROWTH) * multiplier);

  return { min, max, xp: max - min };
}

/** Nivel que corresponde a una cantidad total de XP */
export function findLevel(xp: number, multiplier: number = MULTIPLIER): number {
  if (xp === Infinity) return Infinity;
  if (isNaN(xp) || xp <= 0) return 0;

  let level = 0;
  while (xpRange(level, multiplier).min <= xp) {
    level++;
  }
  return level - 1;
}

export function canLevelUp(level: number, xp: number, multiplier: number = MULTIPLIER): boolean {
  if (level < 0 || isNaN(xp) || xp <= 0) return false;
  if (xp === Infinity) return true;
  return level < findLevel(xp, multiplier);
}

/** Progreso hacia el siguiente nivel; current >= 0 y percent en [0, 100] */
export function getLevelProgress(level: number, exp: number, multiplier: number = MULTIPLIER) {
  const { min, xp, max } = xpRange(level, multiplier);
  const safeExp = Number.isFinite(exp) ? exp : min;
  const current = Math.max(0, safeExp - min);
  const percent = Math.max(0, Math.min(100, Math.floor((current / xp) * 100)));
  const remaining = Math.max(0, max - safeExp);

  return {
    current,    // XP acumulada dentro de este nivel
    needed: xp, // XP total del nivel
    remaining,  // XP que falta para subir
    percent,    // 0-100
    min,
    max
  };
}

export function getExpProgressBar(level: number, exp: number, size: number = 10): string {
  const { percent } = getLevelProgress(level, exp);
  const filled = Math.floor((percent / 100) * size);
  const empty = size - filled;

  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + percent + '%';
}

export interface GrantExpResult {
  /** XP efectivamente sumada (ya con multiplicador) */
  gained: number;
  leveledUp: boolean;
  from: number;
  to: number;
}

/**
 * Aplica los bonus de CONFIG.rpg.levelUpBonus por `levels` niveles (negativo retira).
 * Los stats actuales se recortan al máximo real (clase + equipo), como hacía /nivel.
 * Al bajar, los máximos no caen por debajo de DEFAULT_USER (usuarios subidos con
 * el setnivel antiguo nunca recibieron el bonus) y el dinero no se toca: el oro
 * ya gastado no se puede confiscar de forma coherente.
 */
function applyLevelBonus(user: UserRPG, levels: number): void {
  if (levels === 0) return;
  const bonus = CONFIG.rpg.levelUpBonus;

  if (levels > 0) {
    user.maxHealth += levels * bonus.healthPerLevel;
    user.maxStamina += levels * bonus.staminaPerLevel;
    user.maxMana += levels * bonus.manaPerLevel;
    user.money += levels * bonus.moneyPerLevel;
  } else {
    user.maxHealth = Math.max(DEFAULT_USER.maxHealth, user.maxHealth + levels * bonus.healthPerLevel);
    user.maxStamina = Math.max(DEFAULT_USER.maxStamina, user.maxStamina + levels * bonus.staminaPerLevel);
    user.maxMana = Math.max(DEFAULT_USER.maxMana, user.maxMana + levels * bonus.manaPerLevel);
  }

  const real = calculateTotalStats(user);
  if (levels > 0) {
    user.health = Math.min(real.maxHealth, user.health + levels * bonus.healthPerLevel);
    user.stamina = Math.min(real.maxStamina, user.stamina + levels * bonus.staminaPerLevel);
    user.mana = Math.min(real.maxMana, user.mana + levels * bonus.manaPerLevel);
  } else {
    user.health = Math.min(user.health, real.maxHealth);
    user.stamina = Math.min(user.stamina, real.maxStamina);
    user.mana = Math.min(user.mana, real.maxMana);
  }
}

/**
 * Motor único de XP: suma experiencia, sube los niveles que correspondan y
 * aplica el bonus por nivel. Muta `user`; el caller persiste con db.updateUser.
 */
export function grantExp(user: UserRPG, amount: number, opts: { multiplier?: number } = {}): GrantExpResult {
  const multiplier = Number.isFinite(opts.multiplier) && (opts.multiplier as number) > 0 ? (opts.multiplier as number) : 1;
  const gained = Number.isFinite(amount) && amount > 0 ? Math.floor(amount * multiplier) : 0;

  const from = Math.max(0, Math.floor(user.level || 0));
  user.level = from;
  user.exp = Math.max(0, (Number.isFinite(user.exp) ? user.exp : 0) + gained);

  // Nunca se baja de nivel por aquí: un owner puede haber fijado un nivel por encima de la XP
  const to = Math.max(from, findLevel(user.exp));
  if (to > from) {
    applyLevelBonus(user, to - from);
    user.level = to;
  }

  return { gained, leveledUp: to > from, from, to };
}

/** Fija un nivel exacto dejando la XP en el mínimo de ese nivel y ajustando los bonus */
export function setLevel(user: UserRPG, level: number): { from: number; to: number } {
  const to = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
  const from = Math.max(0, Math.floor(user.level || 0));

  applyLevelBonus(user, to - from);
  user.level = to;
  user.exp = xpRange(to).min;

  return { from, to };
}

/** Resta XP sin bajar nunca del mínimo del nivel actual; devuelve lo restado */
export function loseExp(user: UserRPG, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const floor = xpRange(Math.max(0, Math.floor(user.level || 0))).min;
  const current = Number.isFinite(user.exp) ? user.exp : floor;
  const lost = Math.max(0, Math.min(Math.floor(amount), current - floor));
  user.exp = current - lost;
  return lost;
}
