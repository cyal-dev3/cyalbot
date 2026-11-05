import { getDatabase } from './database.js';
import { calculateTotalStats } from './rpg-utils.js';
import { REGEN } from '../constants/rpg.js';
import { createLogger } from './logger.js';
import type { UserRPG } from '../types/user.js';

const log = createLogger('regen');

const HOUR_MS = 60 * 60 * 1000;

interface RegenConfig {
  healthPerHour: number;
  staminaPerHour: number;
  checkIntervalMs: number;
}

export const regenConfig: RegenConfig = {
  healthPerHour: REGEN.HEALTH_PER_HOUR,
  staminaPerHour: REGEN.STAMINA_PER_HOUR,
  checkIntervalMs: REGEN.CHECK_INTERVAL_MS
};

let regenTimer: NodeJS.Timeout | null = null;

/** Milisegundos que tarda en regenerarse un punto */
function pointIntervalMs(regenPerHour: number): number {
  return regenPerHour > 0 ? HOUR_MS / regenPerHour : Infinity;
}

/**
 * Puntos completos regenerados desde `lastRegen` y el timestamp que consume
 * exactamente esos puntos (el resto del tiempo se conserva para el siguiente).
 */
function calculateRegen(lastRegen: number, regenPerHour: number, now: number): { amount: number; newTimestamp: number } {
  const interval = pointIntervalMs(regenPerHour);
  if (!lastRegen || lastRegen <= 0 || !Number.isFinite(interval)) {
    return { amount: 0, newTimestamp: now };
  }

  const elapsed = now - lastRegen;
  if (elapsed < interval) {
    return { amount: 0, newTimestamp: lastRegen };
  }

  const amount = Math.floor(elapsed / interval);
  return { amount, newTimestamp: lastRegen + amount * interval };
}

export interface RegenResult {
  healthRegen: number;
  staminaRegen: number;
  updates: Partial<Pick<UserRPG, 'health' | 'stamina' | 'lastHealthRegen' | 'lastStaminaRegen'>>;
}

/**
 * Cálculo puro de regeneración: no toca la BD ni muta `user`.
 * Inicializa los timestamps a `now` cuando valen 0, aunque el stat esté al máximo,
 * para que el contador empiece a correr desde la primera vez que se ve al usuario.
 */
export function regenUser(user: UserRPG, now: number = Date.now()): RegenResult {
  const result: RegenResult = { healthRegen: 0, staminaRegen: 0, updates: {} };
  const realMax = calculateTotalStats(user);

  if (!user.lastHealthRegen) {
    result.updates.lastHealthRegen = now;
  } else if (user.health < realMax.maxHealth) {
    const regen = calculateRegen(user.lastHealthRegen, regenConfig.healthPerHour, now);
    if (regen.amount > 0) {
      result.healthRegen = Math.min(regen.amount, realMax.maxHealth - user.health);
      result.updates.health = user.health + result.healthRegen;
      result.updates.lastHealthRegen = regen.newTimestamp;
    }
  }

  if (!user.lastStaminaRegen) {
    result.updates.lastStaminaRegen = now;
  } else if (user.stamina < realMax.maxStamina) {
    const regen = calculateRegen(user.lastStaminaRegen, regenConfig.staminaPerHour, now);
    if (regen.amount > 0) {
      result.staminaRegen = Math.min(regen.amount, realMax.maxStamina - user.stamina);
      result.updates.stamina = user.stamina + result.staminaRegen;
      result.updates.lastStaminaRegen = regen.newTimestamp;
    }
  }

  return result;
}

function applyRegenToAllUsers(): void {
  try {
    const db = getDatabase();
    const now = Date.now();
    let usersRegenerated = 0;

    for (const [jid, user] of db.getRegisteredUsers()) {
      const realMax = calculateTotalStats(user);
      if (user.health >= realMax.maxHealth && user.stamina >= realMax.maxStamina) continue;

      const result = regenUser(user, now);
      if (Object.keys(result.updates).length > 0) {
        db.updateUser(jid, result.updates);
        if (result.healthRegen > 0 || result.staminaRegen > 0) usersRegenerated++;
      }
    }

    if (usersRegenerated > 0) {
      log.debug(`regeneración aplicada a ${usersRegenerated} usuarios`);
    }
  } catch (error) {
    log.error('error al aplicar regeneración:', error);
  }
}

/** Aplica la regeneración pendiente de un usuario (se usa al consultar el perfil) */
export function applyRegenToUser(jid: string): { healthRegen: number; staminaRegen: number } {
  try {
    const db = getDatabase();
    const user = db.getUser(jid);
    if (!user.registered) {
      return { healthRegen: 0, staminaRegen: 0 };
    }

    const result = regenUser(user, Date.now());
    if (Object.keys(result.updates).length > 0) {
      db.updateUser(jid, result.updates);
    }
    return { healthRegen: result.healthRegen, staminaRegen: result.staminaRegen };
  } catch (error) {
    log.error('error al regenerar usuario:', error);
    return { healthRegen: 0, staminaRegen: 0 };
  }
}

/** Milisegundos hasta que se regenere el siguiente punto */
export function msUntilNextPoint(lastRegen: number, regenPerHour: number, now: number = Date.now()): number {
  const interval = pointIntervalMs(regenPerHour);
  if (!Number.isFinite(interval)) return 0;
  if (!lastRegen || lastRegen <= 0 || now < lastRegen) return interval;
  return interval - ((now - lastRegen) % interval);
}

export function getRegenInfo(jid: string): {
  nextHealthRegen: number;
  nextStaminaRegen: number;
  healthPerHour: number;
  staminaPerHour: number;
} {
  const base = {
    nextHealthRegen: 0,
    nextStaminaRegen: 0,
    healthPerHour: regenConfig.healthPerHour,
    staminaPerHour: regenConfig.staminaPerHour
  };
  try {
    const user = getDatabase().getUser(jid);
    const now = Date.now();
    return {
      ...base,
      nextHealthRegen: msUntilNextPoint(user.lastHealthRegen, regenConfig.healthPerHour, now),
      nextStaminaRegen: msUntilNextPoint(user.lastStaminaRegen, regenConfig.staminaPerHour, now)
    };
  } catch {
    return base;
  }
}

export function startAutoRegen(): void {
  if (regenTimer) {
    log.warn('el sistema ya está activo');
    return;
  }

  log.info(`regeneración pasiva activada: +${regenConfig.healthPerHour} vida/h, +${regenConfig.staminaPerHour} energía/h`);
  applyRegenToAllUsers();
  regenTimer = setInterval(applyRegenToAllUsers, regenConfig.checkIntervalMs);
}

export function stopAutoRegen(): void {
  if (regenTimer) {
    clearInterval(regenTimer);
    regenTimer = null;
    log.info('regeneración pasiva detenida');
  }
}
