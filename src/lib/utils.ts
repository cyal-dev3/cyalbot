/**
 * Utilidades
 * Funciones auxiliares y constantes
 */

/**
 * Convierte milisegundos a formato legible
 * @param duration - Duración en milisegundos
 * @returns String formateado (ej: "2 horas 30 minutos")
 */
export function msToTime(duration: number): string {
  if (duration < 0) duration = 0;

  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((duration / (1000 * 60)) % 60);
  const seconds = Math.floor((duration / 1000) % 60);

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} hora${hours > 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minuto${minutes > 1 ? 's' : ''}`);
  }
  if (seconds > 0 && hours === 0) {
    parts.push(`${seconds} segundo${seconds > 1 ? 's' : ''}`);
  }

  return parts.join(' ') || '0 segundos';
}

/**
 * Selecciona un elemento aleatorio de un array
 */
export function pickRandom<T>(list: readonly T[] | T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Estilo de formateo de números
 */
export type NumberFormatStyle = 'locale' | 'compact';

/**
 * Formatea un número con separadores de miles o formato compacto
 * @param num - Número a formatear
 * @param style - 'locale' para separadores (1.234.567) o 'compact' para K/M (1.2M)
 */
export function formatNumber(num: number, style: NumberFormatStyle = 'locale'): string {
  if (style === 'compact') {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toString();
  }
  return num.toLocaleString('es-ES');
}

/**
 * Crea una barra de progreso visual
 * @param current - Valor actual
 * @param max - Valor máximo
 * @param size - Tamaño de la barra (default: 10)
 * @returns Barra de progreso (ej: "████████░░")
 */
export function createProgressBar(current: number, max: number, size: number = 10): string {
  const percent = Math.min(Math.max(current / max, 0), 1);
  const filled = Math.floor(percent * size);
  const empty = size - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Genera un número aleatorio entre min y max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Capitaliza la primera letra de un string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Selecciona un elemento aleatorio basado en pesos
 * @param items - Array de elementos con propiedad 'weight'
 * @returns Elemento seleccionado aleatoriamente según peso
 */
export function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }

  return items[items.length - 1];
}

/**
 * Normaliza un texto removiendo tildes/acentos para búsquedas
 * Convierte: "Poción de Salud" -> "pocion de salud"
 */
export function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remueve diacríticos (tildes, etc)
    .replace(/ñ/g, 'n')
    .replace(/ü/g, 'u');
}

/**
 * Compara dos strings ignorando tildes y mayúsculas
 */
export function matchesIgnoreAccents(text: string, search: string): boolean {
  return normalizeText(text).includes(normalizeText(search));
}

/**
 * 🎨 Colección de emojis para el bot
 */
export const EMOJI = {
  // Estados
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  loading: '⏳',

  // RPG - Stats
  health: '❤️',
  stamina: '⚡',
  mana: '💠',
  exp: '✨',
  level: '📊',

  // RPG - Economía
  coin: '💰',
  diamond: '💎',
  potion: '🧪',
  gift: '🎁',

  // RPG - Acciones
  sword: '⚔️',
  shield: '🛡️',
  work: '🔨',
  adventure: '🗺️',

  // Especiales
  star: '⭐',
  crown: '👑',
  fire: '🔥',
  time: '⏰',
  bot: '🤖',
  magic: '🔮',

  // Decorativos
  sparkles: '✨',
  trophy: '🏆',
  medal: '🎖️',
  target: '🎯'
} as const;

/**
 * Tipo para las claves de emoji
 */
export type EmojiKey = keyof typeof EMOJI;

/**
 * Resultado de verificación de cooldown
 */
export interface CooldownResult {
  /** true si está en cooldown */
  onCooldown: boolean;
  /** Tiempo restante en ms */
  remaining: number;
  /** Cooldown efectivo después de reducciones */
  effectiveCooldown: number;
}

/**
 * Verifica si un usuario está en cooldown
 * @param lastTime - Timestamp de la última acción
 * @param baseCooldown - Cooldown base en ms
 * @param cooldownReduction - Reducción por rango (0-100)
 * @returns Resultado del cooldown
 */
export function checkCooldown(
  lastTime: number,
  baseCooldown: number,
  cooldownReduction: number = 0
): CooldownResult {
  const now = Date.now();
  const reductionMultiplier = 1 - (cooldownReduction / 100);
  const effectiveCooldown = Math.floor(baseCooldown * reductionMultiplier);
  const elapsed = now - lastTime;
  const remaining = Math.max(0, effectiveCooldown - elapsed);

  return {
    onCooldown: elapsed < effectiveCooldown,
    remaining,
    effectiveCooldown
  };
}

/**
 * Contexto mínimo necesario para obtener target user
 */
export interface TargetContext {
  mentionedJid: string[];
  quoted?: { sender?: string };
}

/**
 * Obtiene el JID del usuario objetivo de una acción
 * Busca en menciones primero, luego en mensaje citado
 * @param ctx - Contexto del mensaje con mentionedJid y quoted
 * @returns JID del usuario objetivo o null si no se encuentra
 */
export function getTargetUser(ctx: TargetContext): string | null {
  // Primero menciones
  if (ctx.mentionedJid.length > 0) {
    return ctx.mentionedJid[0];
  }

  // Luego mensaje citado
  if (ctx.quoted?.sender) {
    return ctx.quoted.sender;
  }

  return null;
}
