/**
 * 🔧 Utilidades para CYALTRONIC
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
 * Formatea un número con separadores de miles
 */
export function formatNumber(num: number): string {
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
