/**
 * 👤 Interfaz de usuario RPG para CYALTRONIC
 * Define la estructura de datos de cada jugador
 */

import type { PlayerClass, ClassInfo } from './rpg.js';

/**
 * Item en el inventario del jugador
 */
export interface InventoryItem {
  itemId: string;
  quantity: number;
  enhanceLevel?: number;  // Nivel de mejora (+1 a +10) para el sistema de forja
}

/**
 * Equipamiento del jugador
 */
export interface Equipment {
  weapon: string | null;
  armor: string | null;
  accessory: string | null;
}

/**
 * Progreso de una misión
 */
export interface QuestProgress {
  questId: string;
  progress: number;
  completed: boolean;
  claimedAt?: number;
}

/**
 * Estadísticas de combate
 */
export interface CombatStats {
  totalKills: number;
  dungeonsCompleted: number;
  pvpWins: number;
  pvpLosses: number;
  totalDamageDealt: number;
  totalDamageReceived: number;
  bossesKilled: number;
}

/**
 * Buff activo en el jugador
 */
export interface ActiveBuff {
  type: 'expBoost' | 'attackBoost' | 'defenseBoost';
  value: number;
  expiresAt: number;
}

export interface UserRPG {
  // 📝 Datos de registro
  name: string;
  age: number;
  registered: boolean;
  regTime: number;

  // 📊 Sistema de niveles
  level: number;
  exp: number;
  role: string;

  // 🎭 Clase del jugador
  playerClass: PlayerClass | null;
  classSelectedAt: number;

  // ⚔️ Estadísticas base
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;

  // 📈 Stats de combate derivados
  attack: number;
  defense: number;
  critChance: number;

  // 💰 Economía
  money: number;
  limit: number;  // 💎 Diamantes
  potion: number;
  totalEarned: number;  // Para misiones

  // 🎒 Inventario y Equipamiento
  inventory: InventoryItem[];
  equipment: Equipment;

  // 📜 Misiones
  dailyQuests: QuestProgress[];
  weeklyQuests: QuestProgress[];
  lastDailyReset: number;
  lastWeeklyReset: number;

  // 🏆 Logros
  achievements: string[];  // IDs de logros desbloqueados
  titles: string[];        // Títulos disponibles
  currentTitle: string;    // Título actual mostrado

  // 📊 Estadísticas de combate
  combatStats: CombatStats;

  // ✨ Buffs activos
  activeBuffs: ActiveBuff[];

  // ⏰ Cooldowns (timestamps)
  lastClaim: number;
  lastWork: number;
  lastMine: number;
  lastRob: number;
  lastDuel: number;
  lastAttack: number;
  lastDungeon: number;
  lastBomb: number;
  lastFumar: number;  // Cooldown de fumar piedra

  // 🔄 Regeneración pasiva (timestamps)
  lastHealthRegen: number;
  lastStaminaRegen: number;

  // 💀 Sistema de deuda IMSS
  debt: number;  // Deuda por cuotas médicas del IMSS

  // 🛡️ Protecciones activas (timestamps de expiracion)
  shieldRobo: number;       // Proteccion anti-robo hasta timestamp
  shieldBombas: number;     // Proteccion anti-bombas hasta timestamp
  seguroVida: number;       // Seguro de vida (sin cuotas IMSS) hasta timestamp

  // 💋 Sistema de besos
  kissStats: KissStats;

  // 🏦 Sistema de banco
  bank: number;             // Dinero en el banco
  bankDepositTime: number;  // Timestamp de cuando se depositó (para expiración)

  // 🕊️ Modo pasivo
  passiveMode: boolean;           // Si está en modo pasivo
  passiveModeUntil: number;       // Hasta cuando no puede cambiar el modo
  passiveModeChangedAt: number;   // Cuando se cambió por última vez

  // ⛓️ Sistema de esclavitud
  slaveMaster: string | null;     // JID del dueño (si es esclavo)
  slaveUntil: number;             // Hasta cuando es esclavo
  slaves: string[];               // Lista de JIDs de esclavos

  // 💸 Sistema de deuda mejorado
  debtCreatedAt: number;          // Cuando se creó la deuda (para intereses)
  debtInterestApplied: number;    // Última vez que se aplicaron intereses

  // 🤗 Sistema de abrazos
  hugStats: {
    totalGiven: number;
    totalReceived: number;
    hugHistory: { jid: string; count: number; lastHug: number }[];
  };

  // ⚒️ Sistema de forja - Materiales
  forgeMaterials: Record<string, number>;  // {materialId: cantidad}
}

/**
 * Estadísticas de besos del usuario
 */
export interface KissStats {
  totalGiven: number;           // Total de besos dados
  totalReceived: number;        // Total de besos recibidos
  kissHistory: KissRecord[];    // Historial de personas besadas
}

/**
 * Registro de besos con una persona específica
 */
export interface KissRecord {
  jid: string;                  // JID del usuario besado
  count: number;                // Veces que se han besado
  lastKiss: number;             // Timestamp del último beso
}

/**
 * Valores por defecto para un nuevo usuario
 */
export const DEFAULT_USER: UserRPG = {
  // Registro
  name: '',
  age: -1,
  registered: false,
  regTime: -1,

  // Niveles
  level: 0,
  exp: 0,
  role: 'Guerrero V',

  // Clase
  playerClass: null,
  classSelectedAt: 0,

  // Stats base
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  mana: 20,
  maxMana: 20,

  // Stats de combate
  attack: 10,
  defense: 5,
  critChance: 5,

  // Economía
  money: 15,
  limit: 20,
  potion: 10,
  totalEarned: 0,

  // Inventario
  inventory: [],
  equipment: {
    weapon: null,
    armor: null,
    accessory: null
  },

  // Misiones
  dailyQuests: [],
  weeklyQuests: [],
  lastDailyReset: 0,
  lastWeeklyReset: 0,

  // Logros
  achievements: [],
  titles: ['🌱 Novato'],
  currentTitle: '🌱 Novato',

  // Estadísticas de combate
  combatStats: {
    totalKills: 0,
    dungeonsCompleted: 0,
    pvpWins: 0,
    pvpLosses: 0,
    totalDamageDealt: 0,
    totalDamageReceived: 0,
    bossesKilled: 0
  },

  // Buffs
  activeBuffs: [],

  // Cooldowns
  lastClaim: 0,
  lastWork: 0,
  lastMine: 0,
  lastRob: 0,
  lastDuel: 0,
  lastAttack: 0,
  lastDungeon: 0,
  lastBomb: 0,
  lastFumar: 0,

  // Regeneración pasiva
  lastHealthRegen: 0,
  lastStaminaRegen: 0,

  // Deuda IMSS
  debt: 0,

  // Protecciones
  shieldRobo: 0,
  shieldBombas: 0,
  seguroVida: 0,

  // Besos
  kissStats: {
    totalGiven: 0,
    totalReceived: 0,
    kissHistory: []
  },

  // Banco
  bank: 0,
  bankDepositTime: 0,

  // Modo pasivo
  passiveMode: false,
  passiveModeUntil: 0,
  passiveModeChangedAt: 0,

  // Esclavitud
  slaveMaster: null,
  slaveUntil: 0,
  slaves: [],

  // Deuda mejorada
  debtCreatedAt: 0,
  debtInterestApplied: 0,

  // Abrazos
  hugStats: {
    totalGiven: 0,
    totalReceived: 0,
    hugHistory: []
  },

  // Forja - Materiales
  forgeMaterials: {}
};

/**
 * Categorías de rango para beneficios
 */
export type RankCategory =
  | 'guerrero'
  | 'elite'
  | 'maestro'
  | 'gran_maestro'
  | 'epico'
  | 'leyenda'
  | 'mitico'
  | 'gloria_mitica'
  | 'esmeralda'
  | 'titan'
  | 'dragon';

/**
 * Beneficios por categoría de rango
 */
export interface RankBenefits {
  expMultiplier: number;      // Multiplicador de XP ganada
  moneyMultiplier: number;    // Multiplicador de dinero ganado
  robSuccessBonus: number;    // Bonus % a probabilidad de robo exitoso
  robAmountBonus: number;     // Bonus % a cantidad robada
  pvpDamageBonus: number;     // Bonus % a daño en PvP
  pvpDefenseBonus: number;    // Bonus % a defensa en PvP
  dailyBonus: number;         // Bonus % a recompensas diarias
  cooldownReduction: number;  // Reducción % de cooldowns
  critBonus: number;          // Bonus % a probabilidad de crítico
  dungeonRewardBonus: number; // Bonus % a recompensas de dungeon
}

/**
 * Tabla de beneficios por categoría de rango
 */
const RANK_BENEFITS: Record<RankCategory, RankBenefits> = {
  guerrero: {
    expMultiplier: 1.0,
    moneyMultiplier: 1.0,
    robSuccessBonus: 0,
    robAmountBonus: 0,
    pvpDamageBonus: 0,
    pvpDefenseBonus: 0,
    dailyBonus: 0,
    cooldownReduction: 0,
    critBonus: 0,
    dungeonRewardBonus: 0
  },
  elite: {
    expMultiplier: 1.10,      // +10% XP
    moneyMultiplier: 1.10,    // +10% dinero
    robSuccessBonus: 5,       // +5% éxito robo
    robAmountBonus: 10,       // +10% cantidad robada
    pvpDamageBonus: 5,        // +5% daño PvP
    pvpDefenseBonus: 3,       // +3% defensa PvP
    dailyBonus: 10,           // +10% daily
    cooldownReduction: 5,     // -5% cooldowns
    critBonus: 2,             // +2% crit
    dungeonRewardBonus: 10    // +10% dungeon
  },
  maestro: {
    expMultiplier: 1.20,
    moneyMultiplier: 1.20,
    robSuccessBonus: 10,
    robAmountBonus: 15,
    pvpDamageBonus: 10,
    pvpDefenseBonus: 7,
    dailyBonus: 20,
    cooldownReduction: 10,
    critBonus: 5,
    dungeonRewardBonus: 20
  },
  gran_maestro: {
    expMultiplier: 1.35,
    moneyMultiplier: 1.35,
    robSuccessBonus: 15,
    robAmountBonus: 25,
    pvpDamageBonus: 15,
    pvpDefenseBonus: 12,
    dailyBonus: 35,
    cooldownReduction: 15,
    critBonus: 8,
    dungeonRewardBonus: 30
  },
  epico: {
    expMultiplier: 1.50,
    moneyMultiplier: 1.50,
    robSuccessBonus: 20,
    robAmountBonus: 35,
    pvpDamageBonus: 20,
    pvpDefenseBonus: 15,
    dailyBonus: 50,
    cooldownReduction: 20,
    critBonus: 12,
    dungeonRewardBonus: 45
  },
  leyenda: {
    expMultiplier: 1.75,
    moneyMultiplier: 1.75,
    robSuccessBonus: 25,
    robAmountBonus: 45,
    pvpDamageBonus: 28,
    pvpDefenseBonus: 20,
    dailyBonus: 75,
    cooldownReduction: 25,
    critBonus: 15,
    dungeonRewardBonus: 60
  },
  mitico: {
    expMultiplier: 2.0,
    moneyMultiplier: 2.0,
    robSuccessBonus: 30,
    robAmountBonus: 60,
    pvpDamageBonus: 35,
    pvpDefenseBonus: 25,
    dailyBonus: 100,
    cooldownReduction: 30,
    critBonus: 20,
    dungeonRewardBonus: 80
  },
  gloria_mitica: {
    expMultiplier: 2.25,
    moneyMultiplier: 2.25,
    robSuccessBonus: 35,
    robAmountBonus: 70,
    pvpDamageBonus: 40,
    pvpDefenseBonus: 30,
    dailyBonus: 125,
    cooldownReduction: 35,
    critBonus: 25,
    dungeonRewardBonus: 100
  },
  esmeralda: {
    expMultiplier: 2.5,
    moneyMultiplier: 2.5,
    robSuccessBonus: 40,
    robAmountBonus: 85,
    pvpDamageBonus: 50,
    pvpDefenseBonus: 35,
    dailyBonus: 150,
    cooldownReduction: 40,
    critBonus: 30,
    dungeonRewardBonus: 125
  },
  titan: {
    expMultiplier: 3.0,
    moneyMultiplier: 3.0,
    robSuccessBonus: 50,
    robAmountBonus: 100,
    pvpDamageBonus: 65,
    pvpDefenseBonus: 45,
    dailyBonus: 200,
    cooldownReduction: 45,
    critBonus: 40,
    dungeonRewardBonus: 150
  },
  dragon: {
    expMultiplier: 4.0,
    moneyMultiplier: 4.0,
    robSuccessBonus: 60,
    robAmountBonus: 150,
    pvpDamageBonus: 100,
    pvpDefenseBonus: 60,
    dailyBonus: 300,
    cooldownReduction: 50,
    critBonus: 50,
    dungeonRewardBonus: 200
  }
};

/**
 * Sistema de rangos por nivel
 * Cada rango tiene: [nivelMinimo, nivelMaximo, nombreRango]
 */
const ROLE_TIERS: [number, number, string][] = [
  // Guerrero (1-15)
  [0, 2, '🌱 Guerrero V'],
  [3, 5, '🌿 Guerrero IV'],
  [6, 8, '☘️ Guerrero III'],
  [9, 11, '🍀 Guerrero II'],
  [12, 14, '⚔️ Guerrero I'],

  // Elite (15-30)
  [15, 17, '🔵 Elite V'],
  [18, 20, '💠 Elite IV'],
  [21, 23, '🔷 Elite III'],
  [24, 26, '♦️ Elite II'],
  [27, 29, '💎 Elite I'],

  // Maestro (30-45)
  [30, 32, '🟣 Maestro V'],
  [33, 35, '🔮 Maestro IV'],
  [36, 38, '☪️ Maestro III'],
  [39, 41, '✨ Maestro II'],
  [42, 44, '🌟 Maestro I'],

  // Gran Maestro (45-60)
  [45, 47, '🟡 Gran Maestro V'],
  [48, 50, '⭐ Gran Maestro IV'],
  [51, 53, '🌙 Gran Maestro III'],
  [54, 56, '☀️ Gran Maestro II'],
  [57, 59, '💫 Gran Maestro I'],

  // Epico (60-74)
  [60, 62, '🟠 Epico V'],
  [63, 65, '🔶 Epico IV'],
  [66, 68, '🧡 Epico III'],
  [69, 70, '🏵️ Epico II'],
  [71, 73, '🎖️ Epico I'],

  // Leyenda (74-89)
  [74, 76, '🔴 Leyenda V'],
  [77, 79, '❤️ Leyenda IV'],
  [80, 82, '♥️ Leyenda III'],
  [83, 85, '❣️ Leyenda II'],
  [86, 88, '💖 Leyenda I'],

  // Mitico (89-105)
  [89, 90, '🩷 Mitico V'],
  [91, 93, '💗 Mitico IV'],
  [94, 96, '💝 Mitico III'],
  [97, 99, '💞 Mitico II'],
  [100, 104, '💕 Mitico I'],

  // Gloria Mitica (105-120)
  [105, 119, '🏆 Gloria Mitica'],

  // Esmeralda (120-200)
  [120, 149, '💚 Esmeralda V'],
  [150, 159, '🌲 Esmeralda IV'],
  [160, 169, '🌴 Esmeralda III'],
  [170, 184, '🌳 Esmeralda II'],
  [185, 199, '🍃 Esmeralda I'],

  // Titan (200-1000)
  [200, 404, '🗿 Titan III'],
  [405, 699, '🏛️ Titan II'],
  [700, 999, '⚱️ Titan I'],

  // Maximo rango
  [1000, Infinity, '🐉👑 Dragon Rey Estrella']
];

/**
 * Obtiene el rol/título basado en el nivel del jugador
 * @param level - Nivel actual del jugador
 * @returns Título con emoji correspondiente
 */
export function getRoleByLevel(level: number): string {
  for (const [minLevel, maxLevel, role] of ROLE_TIERS) {
    if (level >= minLevel && level <= maxLevel) {
      return role;
    }
  }
  return '🌱 Guerrero V';
}

/**
 * Obtiene información del progreso del rango actual
 * @param level - Nivel actual del jugador
 * @returns Información del rango y progreso
 */
export function getRankProgress(level: number): {
  currentRank: string;
  nextRank: string | null;
  levelsToNext: number;
  isMaxRank: boolean;
} {
  let currentIndex = 0;

  for (let i = 0; i < ROLE_TIERS.length; i++) {
    const [minLevel, maxLevel] = ROLE_TIERS[i];
    if (level >= minLevel && level <= maxLevel) {
      currentIndex = i;
      break;
    }
  }

  const currentRank = ROLE_TIERS[currentIndex][2];
  const isMaxRank = currentIndex >= ROLE_TIERS.length - 1;
  const nextRank = isMaxRank ? null : ROLE_TIERS[currentIndex + 1][2];
  const levelsToNext = isMaxRank ? 0 : ROLE_TIERS[currentIndex + 1][0] - level;

  return {
    currentRank,
    nextRank,
    levelsToNext,
    isMaxRank
  };
}

/**
 * Obtiene la categoría de rango basada en el nivel
 * @param level - Nivel actual del jugador
 * @returns Categoría de rango
 */
export function getRankCategory(level: number): RankCategory {
  if (level >= 1000) return 'dragon';
  if (level >= 200) return 'titan';
  if (level >= 120) return 'esmeralda';
  if (level >= 105) return 'gloria_mitica';
  if (level >= 89) return 'mitico';
  if (level >= 74) return 'leyenda';
  if (level >= 60) return 'epico';
  if (level >= 45) return 'gran_maestro';
  if (level >= 30) return 'maestro';
  if (level >= 15) return 'elite';
  return 'guerrero';
}

/**
 * Obtiene los beneficios del rango actual
 * @param level - Nivel actual del jugador
 * @returns Objeto con todos los beneficios
 */
export function getRankBenefits(level: number): RankBenefits {
  const category = getRankCategory(level);
  return RANK_BENEFITS[category];
}

/**
 * Formatea los beneficios para mostrar al usuario
 * @param level - Nivel actual del jugador
 * @returns String con los beneficios formateados
 */
export function formatRankBenefits(level: number): string {
  const benefits = getRankBenefits(level);
  const category = getRankCategory(level);
  const rank = getRoleByLevel(level);

  let msg = `🎖️ *BENEFICIOS DE RANGO*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${rank}\n\n`;

  if (category === 'guerrero') {
    msg += `_Sube de nivel para desbloquear beneficios!_\n`;
    msg += `_Próximo rango: 🔵 Elite (Nivel 15)_`;
    return msg;
  }

  const bonuses: string[] = [];

  if (benefits.expMultiplier > 1) {
    bonuses.push(`⭐ +${Math.round((benefits.expMultiplier - 1) * 100)}% XP ganada`);
  }
  if (benefits.moneyMultiplier > 1) {
    bonuses.push(`💰 +${Math.round((benefits.moneyMultiplier - 1) * 100)}% dinero ganado`);
  }
  if (benefits.dailyBonus > 0) {
    bonuses.push(`🎁 +${benefits.dailyBonus}% recompensa diaria`);
  }
  if (benefits.pvpDamageBonus > 0) {
    bonuses.push(`⚔️ +${benefits.pvpDamageBonus}% daño PvP`);
  }
  if (benefits.pvpDefenseBonus > 0) {
    bonuses.push(`🛡️ +${benefits.pvpDefenseBonus}% defensa PvP`);
  }
  if (benefits.robSuccessBonus > 0) {
    bonuses.push(`🦹 +${benefits.robSuccessBonus}% éxito robo`);
  }
  if (benefits.robAmountBonus > 0) {
    bonuses.push(`💸 +${benefits.robAmountBonus}% cantidad robada`);
  }
  if (benefits.critBonus > 0) {
    bonuses.push(`💥 +${benefits.critBonus}% probabilidad crítico`);
  }
  if (benefits.cooldownReduction > 0) {
    bonuses.push(`⏰ -${benefits.cooldownReduction}% cooldowns`);
  }
  if (benefits.dungeonRewardBonus > 0) {
    bonuses.push(`🏰 +${benefits.dungeonRewardBonus}% recompensas dungeon`);
  }

  msg += bonuses.join('\n');

  return msg;
}

/**
 * Calcula los stats totales del jugador incluyendo clase y equipamiento
 */
export function calculateTotalStats(
  user: UserRPG,
  items: Record<string, { stats?: { attack?: number; defense?: number; health?: number; mana?: number; stamina?: number; critChance?: number } }>,
  classes?: Record<string, ClassInfo>
): {
  attack: number;
  defense: number;
  maxHealth: number;
  maxMana: number;
  maxStamina: number;
  critChance: number;
} {
  let totalAttack = user.attack;
  let totalDefense = user.defense;
  let totalHealth = user.maxHealth;
  let totalMana = user.maxMana;
  let totalStamina = user.maxStamina;
  let totalCrit = user.critChance;

  // Sumar bonus de clase si existe
  if (classes && user.playerClass && classes[user.playerClass]) {
    const classInfo = classes[user.playerClass];
    totalHealth += classInfo.baseStats.healthBonus;
    totalMana += classInfo.baseStats.manaBonus;
    totalStamina += classInfo.baseStats.staminaBonus;
    totalAttack += classInfo.baseStats.attackBonus;
    totalDefense += classInfo.baseStats.defenseBonus;
  }

  // Sumar stats del equipamiento
  const equipmentSlots = [user.equipment.weapon, user.equipment.armor, user.equipment.accessory];

  for (const itemId of equipmentSlots) {
    if (itemId && items[itemId]?.stats) {
      const stats = items[itemId].stats;
      if (stats.attack) totalAttack += stats.attack;
      if (stats.defense) totalDefense += stats.defense;
      if (stats.health) totalHealth += stats.health;
      if (stats.mana) totalMana += stats.mana;
      if (stats.stamina) totalStamina += stats.stamina;
      if (stats.critChance) totalCrit += stats.critChance;
    }
  }

  return {
    attack: totalAttack,
    defense: totalDefense,
    maxHealth: totalHealth,
    maxMana: totalMana,
    maxStamina: totalStamina,
    critChance: totalCrit
  };
}
