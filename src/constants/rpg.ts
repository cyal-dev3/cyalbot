import type { ItemType } from '../types/rpg.js';

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

  /** Tiempo minimo entre duelos del mismo jugador (user.lastDuel) */
  DUEL_COOLDOWN: 5 * 60 * 1000,

  /** Tiempo minimo entre acciones del mismo jugador dentro de un duelo */
  DUEL_ACTION_COOLDOWN: 1500,

  /** Apuesta permitida en duelos */
  DUEL_BET: { MIN: 100, MAX: 50000 },

  /** Combo: bonus de dano por golpe consecutivo y tope */
  DUEL_COMBO: { PER_HIT: 0.05, MAX: 0.25, MIN_HITS: 3 },

  /** Recursos que regenera cada accion de duelo */
  DUEL_REGEN: { MANA_PER_ACTION: 5, MANA_PER_BLOCK: 8, STAMINA_PER_SKILL: 3 },

  /** Costes de energia de las acciones basicas del duelo */
  DUEL_COSTS: { ATTACK_STAMINA: 5, BLOCK_STAMINA: 3 },

  /** Reduccion de dano al bloquear (0.5 = mitad) */
  BLOCK_REDUCTION: 0.5,

  /** Recompensa de XP del ganador: base + nivel del rival * factor + bonus por duracion */
  DUEL_EXP: { BASE: 300, PER_LOSER_LEVEL: 15, PER_5S: 10, MAX_DURATION_BONUS: 200, RANDOM_MAX: 150 },

  /** Recompensa al matar con una bomba */
  BOMB_KILL_REWARD: { EXP: { MIN: 50, MAX: 150 }, MONEY: { MIN: 100, MAX: 300 } },

  /** Duracion del escudo antibombas (24 horas) */
  SHIELD_DURATION: 24 * 60 * 60 * 1000,

  /** Multiplicadores de combate PvP */
  HEALTH_MULTIPLIER: 2.5,
  DAMAGE_MULTIPLIER: 0.4
} as const;

/**
 * Cooldowns de acciones que no son de combate (ms)
 */
export const COOLDOWNS = {
  /** Fumar piedra */
  FUMAR: 5 * 60 * 1000,

  /** Bombardear (mismo valor que PVP.BOMB_COOLDOWN) */
  BOMB: PVP.BOMB_COOLDOWN,

  /** Alimentar a la mascota */
  FEED: 4 * 60 * 60 * 1000,

  /** Entrenar a la mascota */
  TRAIN: 60 * 60 * 1000,

  /** Cambiar el modo pasivo */
  PASSIVE_MODE: 6 * 60 * 60 * 1000
} as const;

/**
 * Gremios
 */
export const GUILD = {
  /** Costo de crear un gremio */
  CREATE_COST: 10000,

  /** Maximo de miembros por gremio */
  MAX_MEMBERS: 50,

  /** XP necesaria por nivel: guild.level * XP_PER_LEVEL */
  XP_PER_LEVEL: 5000
} as const;

/**
 * Forja
 */
export const FORGE = {
  /** Nivel maximo de mejora de un item */
  MAX_ENHANCE_LEVEL: 10,

  /** Bonus a los stats del item por cada nivel de mejora (%) */
  ENHANCE_BONUS_PER_LEVEL: 5
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
  CHECK_INTERVAL_MS: 60 * 1000
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

  /** Energia que cuesta /atacar */
  ATTACK_STAMINA_COST: 10,

  /** Energia minima para /atacar */
  ATTACK_MIN_STAMINA: 10,

  /** Turnos maximos de un combate simulado; al llegar es empate */
  MAX_TURNS: 20,

  /** Multiplicadores de dungeon */
  DUNGEON: {
    DROP_CHANCE_REDUCTION: 0.5,
    /** PARTIAL: muerto ante un monstruo normal; FULL: muerto ante el boss */
    XP_MULTIPLIER_ON_DEATH: { PARTIAL: 0.5, FULL: 0.7 },
    /** Multiplicador de recompensas al huir o abandonar por inactividad */
    XP_MULTIPLIER_ON_FLEE: 0.3,
    XP_MULTIPLIER_ON_TIMEOUT: 0.2,
    BOSS_STATS_MULTIPLIER: {
      HEALTH: 1.5,
      ATTACK: 1.2,
      DEFENSE: 1.2
    },
    /** Turnos maximos por encuentro en el modo rapido */
    MAX_TURNS_PER_FIGHT: 10,
    /** Recompensa extra del boss (XP y dinero) */
    BOSS_REWARD_MULTIPLIER: 2,
    /** Regeneracion entre encuentros (interactivo) */
    REGEN_BETWEEN: { MANA: 5, STAMINA: 10 },
    REGEN_BEFORE_BOSS: { MANA: 10, STAMINA: 15 },
    /** Tiempo para actuar en cada turno (interactivo) */
    ACTION_TIMEOUT: 60 * 1000,
    /** Turnos perdidos seguidos antes de abandonar la sesion */
    MAX_TIMEOUTS: 3,
    /** Inactividad tras la cual se limpia una sesion colgada */
    SESSION_INACTIVITY: 10 * 60 * 1000,
    CLEANUP_INTERVAL: 5 * 60 * 1000,
    /** Defender: reduccion de dano y mana regenerado */
    DEFEND_REDUCTION: 0.5,
    DEFEND_MANA_REGEN: 5,
    /** Huir: probabilidad base + hasta FLEE_STAMINA_BONUS segun la energia restante */
    FLEE_BASE_CHANCE: 0.4,
    FLEE_STAMINA_BONUS: 0.2
  }
} as const;

/**
 * Items especiales de la tienda de diamantes
 */
export const SPECIAL_ITEMS = {
  /** Duracion del mute del ticket */
  MUTE_DURATION: 24 * 60 * 60 * 1000,
  /** Duracion del seguro de vida */
  LIFE_INSURANCE_DURATION: 48 * 60 * 60 * 1000,
  /** Dinero que roba la bomba a cada jugador */
  MONEY_BOMB: { MIN: 500, MAX: 2000 },
  /** Dinero del cofre de oro */
  GOLD_CHEST: { MIN: 5000, MAX: 15000 },
  /** Pocion de suerte: % extra de probabilidad de drop y duracion */
  LUCK_POTION: { DROP_BONUS: 20, DURATION: 60 * 60 * 1000 },
  /** Runa de experiencia: +25 % por runa, maximo 3 */
  PERMANENT_EXP: { PER_STACK: 0.25, MAX_STACKS: 3 },
  /** Nombre de aventurero */
  NAME_LENGTH: { MIN: 2, MAX: 25 }
} as const;

/**
 * Jefe mundial
 */
export const BOSS = {
  /** Tiempo entre ataques del mismo jugador */
  ATTACK_COOLDOWN: 2 * 60 * 1000,
  /** Energia que cuesta atacar al jefe */
  STAMINA_COST: 15,
  /** Vida del jefe = BASE_HEALTH + nivel medio de los atacantes * HEALTH_PER_LEVEL */
  BASE_HEALTH: 20000,
  ATTACK: 60,
  DEFENSE: 30,
  /** Botin al morir: dinero repartido entre el top y XP para todos los que participaron */
  REWARD: { MONEY_POOL: 30000, EXP_PER_DAMAGE: 0.5, TOP_SHARE: [0.5, 0.3, 0.2] },
  /** Jugadores en el podio */
  TOP_SIZE: 3
} as const;

/**
 * Tienda
 */
export const SHOP = {
  /** Items por pagina en /tienda */
  PAGE_SIZE: 8,
  /** Cantidad maxima por compra */
  MAX_PER_PURCHASE: 99,
  /** Tope de unidades por item (por defecto sin tope salvo MAX_INVENTORY_SIZE) */
  MAX_STACK: {
    doble_exp_permanente: 3,
    ticket_muteo: 10,
    ticket_kick: 10
  } as Record<string, number>
} as const;

/**
 * Emoji por tipo de item
 */
export const ITEM_TYPE_EMOJI: Record<ItemType, string> = {
  weapon: '⚔️',
  armor: '🛡️',
  accessory: '💍',
  consumable: '🧪',
  material: '📦'
};

/**
 * Nombre en plural por tipo de item
 */
export const ITEM_TYPE_NAMES: Record<ItemType, string> = {
  weapon: 'Armas',
  armor: 'Armaduras',
  accessory: 'Accesorios',
  consumable: 'Consumibles',
  material: 'Materiales'
};

export type EquipmentSlot = 'weapon' | 'armor' | 'accessory';

/**
 * Palabras que el jugador puede escribir para referirse a un slot de equipo
 */
export const SLOT_ALIASES: Record<string, EquipmentSlot> = {
  arma: 'weapon',
  armas: 'weapon',
  weapon: 'weapon',
  armadura: 'armor',
  armaduras: 'armor',
  armor: 'armor',
  accesorio: 'accessory',
  accesorios: 'accessory',
  accessory: 'accessory'
};

/**
 * Palabras que el jugador puede escribir para referirse a un tipo de item
 */
export const ITEM_TYPE_ALIASES: Record<string, ItemType> = {
  arma: 'weapon',
  armas: 'weapon',
  weapon: 'weapon',
  weapons: 'weapon',
  armadura: 'armor',
  armaduras: 'armor',
  armor: 'armor',
  accesorio: 'accessory',
  accesorios: 'accessory',
  accessory: 'accessory',
  consumible: 'consumable',
  consumibles: 'consumable',
  consumable: 'consumable',
  pocion: 'consumable',
  pociones: 'consumable',
  potions: 'consumable',
  material: 'material',
  materiales: 'material'
};

/**
 * Limites del sistema
 */
export const LIMITS = {
  /** Maximo de items en inventario */
  MAX_INVENTORY_SIZE: 500,

  /** Maximo de registros en kissHistory */
  MAX_KISS_HISTORY: 100
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
