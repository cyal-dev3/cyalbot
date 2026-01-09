/**
 * 📊 Sistema de Niveles para CYALTRONIC
 * Fórmula exponencial basada en el bot original
 */

/**
 * Factor de crecimiento exponencial
 * Fórmula: (π/e)^φ * e * 0.75
 * Donde φ (phi) = 1.618 (proporción áurea)
 */
export const GROWTH = Math.pow(Math.PI / Math.E, 1.618) * Math.E * 0.75;

/**
 * Multiplicador global de XP
 * Ajusta la dificultad de subir de nivel
 */
export const MULTIPLIER = 99;

/**
 * Rango de XP para un nivel
 */
export interface XPRange {
  /** XP mínimo para este nivel */
  min: number;
  /** XP máximo para este nivel */
  max: number;
  /** XP necesario para pasar al siguiente nivel */
  xp: number;
}

/**
 * Calcula el rango de XP para un nivel específico
 * @param level - Nivel del jugador
 * @param multiplier - Multiplicador de XP (default: MULTIPLIER)
 * @returns Objeto con min, max y xp necesario
 */
export function xpRange(level: number, multiplier: number = MULTIPLIER): XPRange {
  if (level < 0) throw new TypeError('❌ El nivel no puede ser negativo');

  level = Math.floor(level);
  const min = level === 0 ? 0 : Math.round(Math.pow(level, GROWTH) * multiplier) + 1;
  const max = Math.round(Math.pow(level + 1, GROWTH) * multiplier);

  return {
    min,
    max,
    xp: max - min
  };
}

/**
 * Encuentra el nivel correspondiente a una cantidad de XP
 * @param xp - Experiencia total del jugador
 * @param multiplier - Multiplicador de XP
 * @returns Nivel actual
 */
export function findLevel(xp: number, multiplier: number = MULTIPLIER): number {
  if (xp === Infinity) return Infinity;
  if (isNaN(xp) || xp <= 0) return 0;

  let level = 0;
  while (xpRange(level, multiplier).min <= xp) {
    level++;
  }
  return level - 1;
}

/**
 * Verifica si el jugador puede subir de nivel
 * @param level - Nivel actual
 * @param xp - XP actual
 * @param multiplier - Multiplicador de XP
 * @returns true si puede subir de nivel
 */
export function canLevelUp(level: number, xp: number, multiplier: number = MULTIPLIER): boolean {
  if (level < 0 || isNaN(xp) || xp <= 0) return false;
  if (xp === Infinity) return true;
  return level < findLevel(xp, multiplier);
}

/**
 * Obtiene el progreso actual hacia el siguiente nivel
 * @param level - Nivel actual
 * @param exp - XP actual
 * @param multiplier - Multiplicador de XP
 * @returns Objeto con información de progreso
 */
export function getLevelProgress(level: number, exp: number, multiplier: number = MULTIPLIER) {
  const { min, xp, max } = xpRange(level, multiplier);
  const current = exp - min;
  const percent = Math.floor((current / xp) * 100);
  const remaining = max - exp;

  return {
    current,    // XP actual en este nivel
    needed: xp, // XP total necesario para subir
    remaining,  // XP que falta para subir
    percent,    // Porcentaje de progreso (0-100)
    min,        // XP mínimo del nivel
    max         // XP máximo del nivel
  };
}

/**
 * Crea una barra de progreso de XP visual
 * @param level - Nivel actual
 * @param exp - XP actual
 * @param size - Tamaño de la barra (default: 10)
 * @returns String con barra de progreso
 */
export function getExpProgressBar(level: number, exp: number, size: number = 10): string {
  const { percent } = getLevelProgress(level, exp);
  const filled = Math.floor((percent / 100) * size);
  const empty = size - filled;

  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + percent + '%';
}
