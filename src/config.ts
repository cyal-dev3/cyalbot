/**
 * Configuración global del bot.
 *
 * Todo lo que depende del entorno (números de owner, nombre, API keys)
 * se lee de variables de entorno. El resto son constantes de juego.
 * Ver `.env.example` para la lista completa.
 */

import { join } from 'node:path';

function envList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(raw.toLowerCase());
}

/**
 * Normaliza un identificador de WhatsApp (JID, LID o número con formato)
 * a solo dígitos, sin sufijo de dispositivo (`:12`) ni dominio (`@s.whatsapp.net`).
 */
export function normalizeNumber(id: string): string {
  return id.split('@')[0].split(':')[0].replace(/\D/g, '');
}

const botName = process.env.BOT_NAME || 'CYALTRONIC';
const owners = envList('BOT_OWNERS').map(normalizeNumber).filter(Boolean);

// Prefijo: una lista de caracteres aceptados. Por defecto ! / .
const prefixChars = process.env.BOT_PREFIX || '!/.';
const prefixRegex = new RegExp(`^[${prefixChars.replace(/[-\]\\^]/g, '\\$&')}]`);

export const CONFIG = {
  botName,
  version: '3.1.0',

  /** Prefijos de comando aceptados (regex contra el inicio del mensaje). */
  prefix: prefixRegex,

  /** Carpeta donde Baileys guarda las credenciales de la sesión. */
  authFolder: process.env.AUTH_FOLDER || 'CyaltronicSession',

  /** Archivo JSON de la base de datos (lowdb). */
  databasePath: process.env.DATABASE_PATH || 'database.json',

  /** Nombre del proceso en pm2 (para /restart y /logs). */
  pm2Name: process.env.PM2_NAME || botName,

  /**
   * Números (o LIDs) con permisos de owner. Solo dígitos.
   * Sin esto, los comandos de owner quedan deshabilitados.
   */
  owners,

  /** Servicio propio de descargas (downloader/). Vacío = comandos de descarga deshabilitados. */
  downloaderApi: {
    url: process.env.DOWNLOADER_API_URL || '',
    /** Las descargas tardan más de 30 s; el cliente aplica además un mínimo de 120 s. */
    timeout: envInt('DOWNLOADER_API_TIMEOUT_MS', 120_000),
    /** Cabecera x-api-key si el servicio define DOWNLOADER_API_KEY. */
    apiKey: process.env.DOWNLOADER_API_KEY || '',
  },

  /** Temporales de ffmpeg (stickers, conversiones). */
  tmpDir: process.env.TMP_DIR || join(process.cwd(), 'tmp'),

  /** Integración con Claude. Se desactiva sola si falta ANTHROPIC_API_KEY. */
  ai: {
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
    /** Responder en privado a cualquier texto, sin prefijo. */
    privateChat: envBool('AI_PRIVATE_CHAT', true),
    /** Responder en grupos cuando mencionan al bot o le responden un mensaje. */
    replyToMentions: envBool('AI_REPLY_TO_MENTIONS', true),
    /** Mensajes por usuario por hora. */
    userHourlyLimit: envInt('AI_USER_HOURLY_LIMIT', 20),
    /** Presupuesto global de tokens por día (entrada + salida). 0 = sin límite. */
    dailyTokenBudget: envInt('AI_DAILY_TOKEN_BUDGET', 2_000_000),
    /** Mensajes recordados por chat. */
    memoryTurns: envInt('AI_MEMORY_TURNS', 20),
    /** Minutos de inactividad antes de olvidar una conversación. */
    memoryTtlMinutes: envInt('AI_MEMORY_TTL_MINUTES', 120),
    /** Largo máximo de la respuesta en tokens. WhatsApp no es para ensayos. */
    maxOutputTokens: envInt('AI_MAX_OUTPUT_TOKENS', 1024),
    /** Esfuerzo de razonamiento: low | medium | high. Para chat, low basta y es más barato. */
    effort: (['low', 'medium', 'high', 'xhigh', 'max'].includes(process.env.AI_EFFORT || '')
      ? process.env.AI_EFFORT
      : 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    /** Personalidad extra que se añade al system prompt. */
    persona: process.env.AI_PERSONA || '',
  },

  cooldowns: {
    daily: 24 * 60 * 60 * 1000,
    work: 10 * 60 * 1000,
    mine: 10 * 60 * 1000,
    adventure: 25 * 60 * 1000,
    hunt: 45 * 60 * 1000,
    rob: 60 * 60 * 1000,
  },

  messages: {
    wait: '⏳ _Procesando tu solicitud..._',
    error: '❌ Ocurrió un error inesperado.',
    cooldown: (time: string) => `⏰ Espera *${time}* para usar este comando de nuevo.`,
    notRegistered: '❌ No estás registrado.\n\n📝 Usa */verificar nombre.edad* para comenzar.',
    noPermission: '🚫 No tienes permiso para usar este comando.',
    ownerOnly: '👑 Este comando es solo para el dueño del bot.',
    groupOnly: '👥 Este comando solo funciona en grupos.',
    privateOnly: '📱 Este comando solo funciona en chat privado.',
  },

  protection: {
    maxMessagesPerInterval: 5,
    intervalMs: 10_000,
    maxWarnings: 3,
    linkRegex: /chat\.whatsapp\.com\/[a-zA-Z0-9]{15,}/gi,
  },

  /** Lista inicial de palabras para /antibad (se puede editar por grupo). */
  defaultBadWords: [
    'puta', 'puto', 'pendejo', 'pendeja', 'cabron', 'cabrón', 'chingar', 'chingada',
    'verga', 'mamón', 'mamona', 'culero', 'culera', 'joto', 'jota', 'marica',
    'pinche', 'mierda', 'culo', 'coño', 'idiota', 'estupido', 'estúpido',
    'imbecil', 'imbécil', 'hdp', 'hp', 'ctm', 'ptm', 'hijueputa', 'malparido',
    'gonorrea', 'huevon', 'huevón', 'webón', 'webon', 'chucha', 'conchetumare',
  ],

  rpg: {
    registerBonus: { money: 5000, exp: 5000 },
    dailyRewards: {
      exp: [2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000],
      money: [1500, 2000, 2500, 3000, 3500, 4000, 5000],
      potion: [3, 4, 5, 6, 7, 8],
      diamonds: [5, 10, 15, 20, 25, 30],
    },
    workRewards: {
      baseExp: 100,
      levelMultiplier: 50,
      bonusChance: 0.2,
      bonusMoney: { min: 50, max: 200 },
    },
    levelUpBonus: {
      healthPerLevel: 5,
      staminaPerLevel: 3,
      manaPerLevel: 2,
      moneyPerLevel: 100,
    },
  },
} as const;

export type Config = typeof CONFIG;

/** Compara un JID/LID con la lista de owners (coincidencia exacta de dígitos). */
export function isOwnerId(id: string): boolean {
  const n = normalizeNumber(id);
  return n.length > 0 && CONFIG.owners.includes(n);
}

/**
 * true si dos identificadores (JID, LID o número) son la misma cuenta:
 * coincidencia exacta de dígitos, nunca por subcadena.
 */
export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeNumber(a);
  return na.length > 0 && na === normalizeNumber(b);
}
