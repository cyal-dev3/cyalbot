import { createLogger } from './logger.js';

const log = createLogger('modes');

/** Identificador con el que los eventos automáticos marcan los modos que activan */
export const AUTO_ACTIVATOR = 'SISTEMA_AUTO';

export interface BonusMode {
  active: boolean;
  expMultiplier: number;
  moneyMultiplier: number;
  manaMultiplier: number;
  expiresAt: number;
  activatedBy: string;
}

export interface FreeRobMode {
  active: boolean;
  expiresAt: number;
  activatedBy: string;
}

export interface EventMode {
  active: boolean;
  dropMultiplier: number;
  eventName: string;
  expiresAt: number;
  activatedBy: string;
}

export interface PvpMode {
  active: boolean;
  damageMultiplier: number;
  expiresAt: number;
  activatedBy: string;
}

export interface ChaosMode {
  active: boolean;
  multiplier: number;
  expiresAt: number;
  activatedBy: string;
}

export interface GlobalModes {
  bonusMode: BonusMode;
  freeRobMode: FreeRobMode;
  eventMode: EventMode;
  pvpMode: PvpMode;
  chaosMode: ChaosMode;
}

export type GlobalModeKey = keyof GlobalModes;

export const GLOBAL_MODE_KEYS: GlobalModeKey[] = ['bonusMode', 'freeRobMode', 'eventMode', 'pvpMode', 'chaosMode'];

/** Estado en memoria; se pierde al reiniciar el bot */
export const globalModes: GlobalModes = {
  bonusMode: {
    active: false,
    expMultiplier: 1,
    moneyMultiplier: 1,
    manaMultiplier: 1,
    expiresAt: 0,
    activatedBy: ''
  },
  freeRobMode: {
    active: false,
    expiresAt: 0,
    activatedBy: ''
  },
  eventMode: {
    active: false,
    dropMultiplier: 1,
    eventName: '',
    expiresAt: 0,
    activatedBy: ''
  },
  pvpMode: {
    active: false,
    damageMultiplier: 1,
    expiresAt: 0,
    activatedBy: ''
  },
  chaosMode: {
    active: false,
    multiplier: 1,
    expiresAt: 0,
    activatedBy: ''
  }
};

/** Desactiva los modos cuya fecha de expiración ya pasó */
export function checkExpiredModes(now: number = Date.now()): void {
  for (const key of GLOBAL_MODE_KEYS) {
    const mode = globalModes[key];
    if (mode.active && now >= mode.expiresAt) {
      mode.active = false;
      log.debug(`modo ${key} expirado`);
    }
  }
}

/** Modos activos (tras limpiar expirados) con el tiempo restante en ms */
export function getActiveModes(now: number = Date.now()): { key: GlobalModeKey; remainingMs: number; activatedBy: string }[] {
  checkExpiredModes(now);
  return GLOBAL_MODE_KEYS
    .filter(key => globalModes[key].active)
    .map(key => ({
      key,
      remainingMs: Math.max(0, globalModes[key].expiresAt - now),
      activatedBy: globalModes[key].activatedBy
    }));
}

export interface RewardAmounts {
  exp: number;
  money: number;
}

export interface AppliedModes extends RewardAmounts {
  /** Líneas para el mensaje al jugador, una por modo que aportó algo */
  lines: string[];
}

/**
 * Aplica los modos globales activos (bonus, caos, evento) a una recompensa.
 * Cada modo suma su extra sobre la cantidad base (no se componen entre sí),
 * que es como lo hacían daily y work. Única implementación: antes había seis
 * copias con órdenes distintos.
 */
export function applyGlobalModes(base: RewardAmounts, now: number = Date.now()): AppliedModes {
  checkExpiredModes(now);
  const baseExp = Math.max(0, Math.floor(base.exp));
  const baseMoney = Math.max(0, Math.floor(base.money));
  let exp = baseExp;
  let money = baseMoney;
  const lines: string[] = [];

  const { bonusMode, chaosMode, eventMode } = globalModes;

  if (bonusMode.active) {
    const extraExp = Math.floor(baseExp * (bonusMode.expMultiplier - 1));
    const extraMoney = Math.floor(baseMoney * (bonusMode.moneyMultiplier - 1));
    exp += extraExp;
    money += extraMoney;
    if (extraExp || extraMoney) {
      lines.push(`🎁 Modo Bonus: +${extraExp} XP, +${extraMoney} monedas`);
    }
  }
  if (chaosMode.active) {
    const extraExp = Math.floor(baseExp * (chaosMode.multiplier - 1));
    const extraMoney = Math.floor(baseMoney * (chaosMode.multiplier - 1));
    exp += extraExp;
    money += extraMoney;
    if (extraExp || extraMoney) {
      lines.push(`🌀 Modo Caos: +${extraExp} XP, +${extraMoney} monedas (x${chaosMode.multiplier})`);
    }
  }
  if (eventMode.active) {
    const extraExp = Math.floor(baseExp * (eventMode.dropMultiplier - 1));
    const extraMoney = Math.floor(baseMoney * (eventMode.dropMultiplier - 1));
    exp += extraExp;
    money += extraMoney;
    if (extraExp || extraMoney) {
      lines.push(`🎉 ${eventMode.eventName || 'Evento'}: +${extraExp} XP, +${extraMoney} monedas (x${eventMode.dropMultiplier})`);
    }
  }

  return { exp, money, lines };
}

/** Multiplicador de daño PvP activo (1 si no hay modo PvP). */
export function pvpDamageMultiplier(now: number = Date.now()): number {
  checkExpiredModes(now);
  return globalModes.pvpMode.active ? globalModes.pvpMode.damageMultiplier : 1;
}
