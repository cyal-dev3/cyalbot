/**
 * 👤 Interfaz de usuario RPG para CYALTRONIC
 * Define la estructura de datos de cada jugador
 */

import type { PlayerClass } from './rpg.js';

/**
 * Item en el inventario del jugador
 */
export interface InventoryItem {
  itemId: string;
  quantity: number;
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
  lastclaim: number;
  lastwork: number;
  lastrob: number;
  lastduel: number;
  lastattack: number;
  lastdungeon: number;
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
  role: '🌱 Novato',

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
  lastclaim: 0,
  lastwork: 0,
  lastrob: 0,
  lastduel: 0,
  lastattack: 0,
  lastdungeon: 0
};

/**
 * Obtiene el rol/título basado en el nivel del jugador
 * @param level - Nivel actual del jugador
 * @returns Título con emoji correspondiente
 */
export function getRoleByLevel(level: number): string {
  const roles: [number, string][] = [
    [0, '🌱 Novato'],
    [5, '⚔️ Aprendiz'],
    [10, '🗺️ Explorador'],
    [20, '🛡️ Guerrero'],
    [35, '⭐ Veterano'],
    [50, '💎 Élite'],
    [75, '🔮 Maestro'],
    [100, '👑 Leyenda'],
    [150, '🌟 Mítico'],
    [200, '🏆 Inmortal']
  ];

  for (let i = roles.length - 1; i >= 0; i--) {
    if (level >= roles[i][0]) return roles[i][1];
  }
  return '🌱 Novato';
}

/**
 * Calcula los stats totales del jugador incluyendo equipamiento
 */
export function calculateTotalStats(user: UserRPG, items: Record<string, { stats?: { attack?: number; defense?: number; health?: number; mana?: number; stamina?: number; critChance?: number } }>): {
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
