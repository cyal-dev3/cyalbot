/**
 * 🎮 Utilidades del Sistema RPG - CYALTRONIC
 * Funciones compartidas entre plugins RPG
 */

import { randomInt } from './utils.js';
import { PVE } from '../constants/rpg.js';

/**
 * Resultado de un cálculo de daño
 */
export interface DamageResult {
  damage: number;
  isCrit: boolean;
}

/**
 * Calcula el daño de un ataque
 * @param attackerAttack - Ataque del atacante
 * @param defenderDefense - Defensa del defensor
 * @param critChance - Probabilidad de crítico (%)
 * @returns Daño calculado y si fue crítico
 */
export function calculateDamage(
  attackerAttack: number,
  defenderDefense: number,
  critChance: number
): DamageResult {
  // Daño base: ataque - 50% de la defensa
  const baseDamage = Math.max(1, attackerAttack - defenderDefense * 0.5);

  // Varianza de -10% a +10%
  const variance = randomInt(-PVE.DAMAGE_VARIANCE, PVE.DAMAGE_VARIANCE) / 100;
  let damage = Math.floor(baseDamage * (1 + variance));

  // Verificar crítico
  const isCrit = randomInt(1, 100) <= critChance;
  if (isCrit) {
    damage = Math.floor(damage * PVE.CRIT_MULTIPLIER);
  }

  return { damage: Math.max(1, damage), isCrit };
}

/**
 * Calcula el daño que hace un monstruo al jugador
 * @param monsterAttack - Ataque del monstruo
 * @param playerDefense - Defensa del jugador
 * @returns Daño calculado y si fue crítico
 */
export function calculateMonsterDamage(
  monsterAttack: number,
  playerDefense: number
): DamageResult {
  return calculateDamage(monsterAttack, playerDefense, PVE.MONSTER_CRIT_CHANCE);
}

/**
 * @deprecated Usa formatNumber(num, 'compact') de utils.ts
 * Formatea un número grande con separadores de miles
 */
export function formatLargeNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Calcula la probabilidad de éxito con límites
 * @param baseChance - Probabilidad base
 * @param bonuses - Suma de bonificaciones
 * @param penalties - Suma de penalizaciones
 * @param min - Mínimo permitido
 * @param max - Máximo permitido
 */
export function calculateSuccessChance(
  baseChance: number,
  bonuses: number,
  penalties: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, baseChance + bonuses - penalties));
}
