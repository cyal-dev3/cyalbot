import { randomInt } from './utils.js';
import { PVE, FORGE } from '../constants/rpg.js';
import { ITEMS, CLASSES } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';

export interface DamageResult {
  damage: number;
  isCrit: boolean;
}

export interface TotalStats {
  attack: number;
  defense: number;
  maxHealth: number;
  maxMana: number;
  maxStamina: number;
  critChance: number;
}

/**
 * Calcula el daño de un ataque.
 * @param attack - Ataque del atacante
 * @param defense - Defensa del defensor
 * @param critChance - Probabilidad de crítico (%)
 * @param multiplier - Multiplicador extra (habilidades, modos globales)
 */
export function calculateDamage(
  attack: number,
  defense: number,
  critChance: number,
  multiplier: number = 1
): DamageResult {
  const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const baseDamage = Math.max(1, attack - defense * 0.5);

  const variance = randomInt(-PVE.DAMAGE_VARIANCE, PVE.DAMAGE_VARIANCE) / 100;
  let damage = Math.floor(baseDamage * (1 + variance) * safeMultiplier);

  const isCrit = randomInt(1, 100) <= critChance;
  if (isCrit) {
    damage = Math.floor(damage * PVE.CRIT_MULTIPLIER);
  }

  return { damage: Math.max(1, damage), isCrit };
}

/** Multiplicador que aplica el nivel de forja a los stats de un item */
export function getEnhanceMultiplier(enhanceLevel: number): number {
  const level = Math.max(0, Math.min(FORGE.MAX_ENHANCE_LEVEL, Math.floor(enhanceLevel || 0)));
  return 1 + (level * FORGE.ENHANCE_BONUS_PER_LEVEL) / 100;
}

/**
 * Única fuente de stats totales: base del usuario + bonus de clase + equipo
 * (con el bonus del nivel de forja de cada pieza equipada).
 */
export function calculateTotalStats(user: UserRPG): TotalStats {
  const total: TotalStats = {
    attack: user.attack,
    defense: user.defense,
    maxHealth: user.maxHealth,
    maxMana: user.maxMana,
    maxStamina: user.maxStamina,
    critChance: user.critChance
  };

  if (user.playerClass && CLASSES[user.playerClass]) {
    const base = CLASSES[user.playerClass].baseStats;
    total.maxHealth += base.healthBonus;
    total.maxMana += base.manaBonus;
    total.maxStamina += base.staminaBonus;
    total.attack += base.attackBonus;
    total.defense += base.defenseBonus;
  }

  const equipment = user.equipment ?? { weapon: null, armor: null, accessory: null };
  const inventory = Array.isArray(user.inventory) ? user.inventory : [];

  for (const itemId of [equipment.weapon, equipment.armor, equipment.accessory]) {
    if (!itemId) continue;
    const stats = ITEMS[itemId]?.stats;
    if (!stats) continue;

    // El nivel de forja vive en la entrada del inventario del item equipado
    const enhanceLevel = inventory.find(i => i.itemId === itemId)?.enhanceLevel ?? 0;
    const factor = getEnhanceMultiplier(enhanceLevel);

    if (stats.attack) total.attack += Math.round(stats.attack * factor);
    if (stats.defense) total.defense += Math.round(stats.defense * factor);
    if (stats.health) total.maxHealth += Math.round(stats.health * factor);
    if (stats.mana) total.maxMana += Math.round(stats.mana * factor);
    if (stats.stamina) total.maxStamina += Math.round(stats.stamina * factor);
    if (stats.critChance) total.critChance += Math.round(stats.critChance * factor);
  }

  return total;
}
