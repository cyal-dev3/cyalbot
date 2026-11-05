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
