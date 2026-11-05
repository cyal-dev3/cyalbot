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

  const days = Math.floor(duration / (1000 * 60 * 60 * 24));
  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((duration / (1000 * 60)) % 60);
  const seconds = Math.floor((duration / 1000) % 60);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} día${days > 1 ? 's' : ''}`);
  }
  if (hours > 0) {
    parts.push(`${hours} hora${hours > 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minuto${minutes > 1 ? 's' : ''}`);
  }
  if (seconds > 0 && hours === 0 && days === 0) {
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
  /** JID del chat; se usa para descartar citas sin participante (que apuntan al grupo). */
  chat?: string;
  sender?: string;
}

export interface TargetOptions {
  /** Aceptar un número de teléfono escrito en los argumentos (ej. 5213312345678). */
  args?: string[];
  /** Permitir que el objetivo sea el propio remitente. */
  allowSelf?: boolean;
}

/**
 * Obtiene el JID del usuario objetivo de una acción: mención, luego mensaje
 * citado, luego (si se pasan args) un número de teléfono en los argumentos.
 * Nunca devuelve el JID de un grupo.
 */
export function getTargetUser(ctx: TargetContext, options: TargetOptions = {}): string | null {
  const candidates: string[] = [];
  if (ctx.mentionedJid.length > 0) candidates.push(ctx.mentionedJid[0]);
  if (ctx.quoted?.sender) candidates.push(ctx.quoted.sender);
  if (options.args) {
    const number = options.args.find((a) => /^\+?\d{7,16}$/.test(a.replace(/[\s-]/g, '')));
    if (number) candidates.push(`${number.replace(/\D/g, '')}@s.whatsapp.net`);
  }
  for (const jid of candidates) {
    if (!jid || jid.endsWith('@g.us') || jid === ctx.chat) continue;
    if (!options.allowSelf && ctx.sender && jid === ctx.sender) continue;
    return jid;
  }
  return null;
}

/** Como getTargetUser, pero si no hay objetivo devuelve al propio remitente. */
export function getTargetUserOrSelf(ctx: TargetContext & { sender: string }, options: TargetOptions = {}): string {
  return getTargetUser(ctx, { ...options, allowSelf: true }) ?? ctx.sender;
}

/** Texto "@numero" que WhatsApp convierte en mención si el JID va en `mentions`. */
export function mentionTag(jid: string): string {
  return `@${jid.split('@')[0].split(':')[0]}`;
}

/** Nombre legible: nombre registrado, luego pushName, luego el número. */
export function displayName(jid: string, registeredName?: string | null, pushName?: string | null): string {
  return (registeredName && registeredName.trim()) || (pushName && pushName.trim()) || jid.split('@')[0].split(':')[0];
}

/**
 * Interpreta una cantidad escrita por el usuario: "1000", "1k", "2.5m",
 * "todo"/"all"/"max", "mitad", "50%". Devuelve null si no es válida.
 * @param max - saldo disponible, para "todo", "mitad" y porcentajes
 */
export function parseAmount(raw: string | undefined, max?: number): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase().replace(/[,_]/g, '');
  if (!text) return null;
  if (['todo', 'all', 'max', 'maximo', 'máximo'].includes(text)) return max !== undefined ? Math.floor(max) : null;
  if (['mitad', 'half'].includes(text)) return max !== undefined ? Math.floor(max / 2) : null;
  const percent = text.match(/^(\d{1,3})%$/);
  if (percent) {
    if (max === undefined) return null;
    const pct = Math.min(100, parseInt(percent[1], 10));
    return Math.floor((max * pct) / 100);
  }
  const match = text.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return null;
  let value = parseFloat(match[1]);
  if (match[2] === 'k') value *= 1_000;
  if (match[2] === 'm') value *= 1_000_000;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}
