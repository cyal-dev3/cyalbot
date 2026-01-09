/**
 * 🎮 Constantes Centralizadas del Sistema RPG
 * Todos los valores configurables del RPG en un solo lugar
 */

/**
 * Configuracion de combate PvP
 */
export const PVP = {
  /** Probabilidad de que bomba explote en manos (%) */
  BACKFIRE_CHANCE: 35,

  /** Dano de bomba */
  BOMB_DAMAGE: { MIN: 30, MAX: 60 },

  /** Cooldowns en milisegundos */
  ATTACK_COOLDOWN: 3 * 60 * 1000,     // 3 minutos
  BOMB_COOLDOWN: 30 * 60 * 1000,      // 30 minutos
  DUNGEON_COOLDOWN: 30 * 60 * 1000,   // 30 minutos
  DUEL_TIMEOUT: 2 * 60 * 1000,        // 2 minutos para aceptar duelo

  /** Salud minima requerida */
  MIN_HEALTH_COMBAT: 20,
  MIN_HEALTH_DUNGEON: 50,
  MIN_HEALTH_DUEL: 30,

  /** Nivel minimo para PvP */
  MIN_LEVEL_PVP: 5,

  /** Duracion del escudo antibombas (24 horas) */
  SHIELD_DURATION: 24 * 60 * 60 * 1000,

  /** Multiplicadores de combate PvP */
  HEALTH_MULTIPLIER: 2.5,
  DAMAGE_MULTIPLIER: 0.4,

  /** Recompensas por kill en PvP */
  KILL_REWARDS: {
    EXP: { MIN: 50, MAX: 150 },
    MONEY: { MIN: 100, MAX: 300 }
  }
} as const;

/**
 * Sistema IMSS (cuotas medicas por muerte)
 */
export const IMSS = {
  TIERS: {
    LOW: { chance: 70, min: 500, max: 2000, emoji: '🏥', name: 'baja' },
    MEDIUM: { chance: 25, min: 2001, max: 5000, emoji: '🏨', name: 'media' },
    HIGH: { chance: 5, min: 5001, max: 10000, emoji: '🏩', name: 'ALTA' }
  }
} as const;

/**
 * Sistema de robo
 */
export const ROB = {
  /** Probabilidad base de exito (%) */
  BASE_CHANCE: 40,

  /** Bonus por nivel del ladron (%) */
  THIEF_BONUS_PER_LEVEL: 2,

  /** Defensa por nivel de victima (%) */
  VICTIM_DEFENSE_PER_LEVEL: 3,

  /** Probabilidad maxima/minima de exito */
  MAX_SUCCESS_CHANCE: 85,
  MIN_SUCCESS_CHANCE: 15,

  /** Porcentajes de robo por recurso */
  MONEY_STEAL_PERCENT: { MIN: 0.15, MAX: 0.35 },
  EXP_STEAL_PERCENT: { MIN: 0.05, MAX: 0.15 },
  MANA_STEAL: { MIN: 10, MAX: 40 },

  /** Penalizacion por fallo */
  FAIL_PENALTY: { MIN: 100, MAX: 500 },

  /** Probabilidades de tipo de recurso (sumando 100%) */
  RESOURCE_CHANCES: {
    MONEY: 70,  // 70%
    EXP: 20,    // 20% (acumulado: 90%)
    MANA: 10    // 10% (acumulado: 100%)
  },

  /** Minimos requeridos en victima para cada recurso */
  MIN_VICTIM_RESOURCES: {
    MONEY: 100,
    EXP: 500,
    MANA: 10
  }
} as const;

/**
 * Regeneracion automatica
 */
export const REGEN = {
  /** Puntos regenerados por hora */
  HEALTH_PER_HOUR: 10,
  STAMINA_PER_HOUR: 10,

  /** Intervalo de verificacion (1 minuto) */
  CHECK_INTERVAL_MS: 60 * 1000,

  /** Tiempo minimo entre regeneraciones (~36 segundos) */
  MIN_TIME_HOURS: 0.01
} as const;

/**
 * Combate contra monstruos (PvE)
 */
export const PVE = {
  /** Probabilidad de critico del monstruo (%) */
  MONSTER_CRIT_CHANCE: 5,

  /** Varianza de dano (%) */
  DAMAGE_VARIANCE: 10,

  /** Multiplicador de dano critico */
  CRIT_MULTIPLIER: 1.5,

  /** Multiplicadores de dungeon */
  DUNGEON: {
    DROP_CHANCE_REDUCTION: 0.5,
    XP_MULTIPLIER_ON_DEATH: { PARTIAL: 0.5, FULL: 0.7 },
    BOSS_STATS_MULTIPLIER: {
      HEALTH: 1.5,
      ATTACK: 1.2,
      DEFENSE: 1.2
    }
  }
} as const;

/**
 * Limites del sistema
 */
export const LIMITS = {
  /** Maximo de items en inventario */
  MAX_INVENTORY_SIZE: 500,

  /** Maximo de registros en kissHistory */
  MAX_KISS_HISTORY: 100,

  /** Maximo de cache de grupos (LRU) */
  MAX_GROUP_CACHE: 1000
} as const;

/**
 * Configuracion de clases
 */
export const CLASS = {
  /** Nivel minimo para seleccionar clase */
  MIN_LEVEL: 5,

  /** Costo de cambio de clase */
  CHANGE_COST: 10000
} as const;

/**
 * Configuracion de buffs
 */
export const BUFFS = {
  /** Multiplicador de boost de experiencia */
  EXP_BOOST: 0.1
} as const;

/**
 * Calcula la cuota del IMSS basada en probabilidades
 */
export function calculateIMSSFee(randomFn: (min: number, max: number) => number): {
  amount: number;
  tier: keyof typeof IMSS.TIERS;
  emoji: string;
  name: string;
} {
  const roll = randomFn(1, 100);

  if (roll <= IMSS.TIERS.LOW.chance) {
    return {
      amount: randomFn(IMSS.TIERS.LOW.min, IMSS.TIERS.LOW.max),
      tier: 'LOW',
      emoji: IMSS.TIERS.LOW.emoji,
      name: IMSS.TIERS.LOW.name
    };
  } else if (roll <= IMSS.TIERS.LOW.chance + IMSS.TIERS.MEDIUM.chance) {
    return {
      amount: randomFn(IMSS.TIERS.MEDIUM.min, IMSS.TIERS.MEDIUM.max),
      tier: 'MEDIUM',
      emoji: IMSS.TIERS.MEDIUM.emoji,
      name: IMSS.TIERS.MEDIUM.name
    };
  } else {
    return {
      amount: randomFn(IMSS.TIERS.HIGH.min, IMSS.TIERS.HIGH.max),
      tier: 'HIGH',
      emoji: IMSS.TIERS.HIGH.emoji,
      name: IMSS.TIERS.HIGH.name
    };
  }
}
