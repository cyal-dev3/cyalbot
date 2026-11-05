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
 * Regeneración de un stat. Con el stat al máximo el timestamp avanza igualmente
 * (en múltiplos del intervalo, para no marcar dirty cada minuto): si no, un
 * usuario que lleva horas lleno recuperaría de golpe todo ese tiempo al recibir
 * daño, y la regeneración sería un escudo tras cada pelea.
 */
function regenStat(current: number, max: number, lastRegen: number, perHour: number, now: number): {
  regen: number;
  value?: number;
  timestamp?: number;
} {
  if (!lastRegen) return { regen: 0, timestamp: now };

  const { amount, newTimestamp } = calculateRegen(lastRegen, perHour, now);
  if (amount <= 0) return { regen: 0 };
  if (current >= max) return { regen: 0, timestamp: newTimestamp };

  const regen = Math.min(amount, max - current);
  return { regen, value: current + regen, timestamp: newTimestamp };
}

/**
 * Cálculo puro de regeneración: no toca la BD ni muta `user`.
 * Inicializa los timestamps a `now` cuando valen 0, aunque el stat esté al máximo,
 * para que el contador empiece a correr desde la primera vez que se ve al usuario.
 */
export function regenUser(user: UserRPG, now: number = Date.now()): RegenResult {
  const result: RegenResult = { healthRegen: 0, staminaRegen: 0, updates: {} };
  const realMax = calculateTotalStats(user);

  const health = regenStat(user.health, realMax.maxHealth, user.lastHealthRegen, regenConfig.healthPerHour, now);
  result.healthRegen = health.regen;
  if (health.value !== undefined) result.updates.health = health.value;
  if (health.timestamp !== undefined) result.updates.lastHealthRegen = health.timestamp;

  const stamina = regenStat(user.stamina, realMax.maxStamina, user.lastStaminaRegen, regenConfig.staminaPerHour, now);
  result.staminaRegen = stamina.regen;
  if (stamina.value !== undefined) result.updates.stamina = stamina.value;
  if (stamina.timestamp !== undefined) result.updates.lastStaminaRegen = stamina.timestamp;

  return result;
}

/**
 * Barrido periódico sobre todos los registrados: regenUser ya devuelve updates
 * vacío cuando no hay nada que hacer, y los usuarios al máximo también necesitan
 * visita (inicializar o avanzar sus timestamps).
 */
export function applyRegenToAllUsers(): void {
  try {
    const db = getDatabase();
    const now = Date.now();
    let usersRegenerated = 0;

    for (const [jid, user] of db.getRegisteredUsers()) {
      // Un usuario corrupto no debe abortar la regeneración de los demás
      try {
        const result = regenUser(user, now);
        if (Object.keys(result.updates).length > 0) {
          db.updateUser(jid, result.updates);
          if (result.healthRegen > 0 || result.staminaRegen > 0) usersRegenerated++;
        }
      } catch (error) {
        log.error(`error al regenerar a ${jid}:`, error);
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
