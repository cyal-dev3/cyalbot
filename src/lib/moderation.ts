/**
 * Utilidades de moderación compartidas por el handler y los plugins de grupo:
 * palabras prohibidas, enlaces y advertencias automáticas.
 *
 * La detección de palabras es por palabra completa e ignora acentos y
 * mayúsculas, así "puta" no dispara con "computadora" ni "culo" con
 * "vínculo", pero sí detecta "PUTA", "pùta" o "puta," con signos pegados.
 */

import { areJidsSameUser, type GroupMetadata, type WASocket } from 'baileys';
import type { ChatSettings, UserWarning } from '../types/database.js';
import { CONFIG } from '../config.js';
import { mentionTag } from './utils.js';
import { canonicalJid, removeParticipant } from './participants.js';

/** Minúsculas, sin acentos ni diacríticos. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n');
}

/** Separa en palabras usando letras y dígitos Unicode; lo demás es separador. */
function tokenize(text: string): string[] {
  return foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Devuelve la primera palabra prohibida presente en el texto, o null.
 * Si una entrada de la lista tiene espacios se busca como frase.
 */
export function findBadWord(text: string, badWords: readonly string[]): string | null {
  if (!text || badWords.length === 0) return null;
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const joined = ` ${tokens.join(' ')} `;

  for (const raw of badWords) {
    const word = foldText(raw).trim();
    if (!word) continue;
    if (word.includes(' ')) {
      if (joined.includes(` ${word.split(/\s+/).join(' ')} `)) return raw;
    } else if (tokens.includes(word)) {
      return raw;
    }
  }
  return null;
}

/** 'wa': invitaciones de WhatsApp y Telegram. 'all': cualquier URL. */
export type AntiLinkMode = 'wa' | 'all';

const WHATSAPP_INVITE = /chat\.whatsapp\.com\/[a-zA-Z0-9]{15,}/i;
const TELEGRAM_LINK = /(?:^|[^a-z0-9.])t\.me\/[a-zA-Z0-9_+]+/i;
const ANY_URL = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|co|gg|tv|app|xyz|info|link|ly|es|mx|ar|cl|pe|ve|ec|uy|py|bo|do|gt|hn|sv|ni|cr|pa|cu|us|uk|de|fr|it|br|pt|ru|cn|jp|kr|in|site|online|store|club|live|video|download|stream|fun|top|pro|dev|ai|to|cc|biz|tk|ml|ga|cf|gq)(?:[/?#][^\s]*)?(?=$|[\s,;!?)])/i;

export function isForbiddenLink(text: string, mode: AntiLinkMode = 'wa'): boolean {
  if (!text) return false;
  if (WHATSAPP_INVITE.test(text) || TELEGRAM_LINK.test(text)) return true;
  return mode === 'all' && ANY_URL.test(text);
}

/** Lee ChatSettings.antiLinkMode (campo pendiente en types/database.ts) con default 'wa'. */
export function getAntiLinkMode(settings: ChatSettings): AntiLinkMode {
  return (settings as ChatSettings & { antiLinkMode?: AntiLinkMode }).antiLinkMode === 'all' ? 'all' : 'wa';
}

/** Lee ChatSettings.maxWarnings (campo pendiente en types/database.ts) con fallback a CONFIG. */
export function getMaxWarnings(settings: ChatSettings): number {
  const value = (settings as ChatSettings & { maxWarnings?: number }).maxWarnings;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : CONFIG.protection.maxWarnings;
}

/** Lee ChatSettings.mutedUntil (campo pendiente en types/database.ts): vencimiento por jid de los mutes temporales. */
export function getMutedUntil(settings: ChatSettings): Record<string, number> {
  const until = (settings as ChatSettings & { mutedUntil?: Record<string, number> }).mutedUntil;
  return until && typeof until === 'object' ? until : {};
}

/**
 * true si el jid está silenciado y, si el mute es temporal, aún no venció.
 * Es pura: no limpia nada. handler.isUserMuted debería usarla (ver handoff).
 */
export function isMutedNow(settings: ChatSettings, jid: string, now = Date.now()): boolean {
  const muted = settings.mutedUsers?.find((u) => areJidsSameUser(u, jid));
  if (!muted) return false;
  const until = getMutedUntil(settings)[muted];
  return until === undefined || until > now;
}

export const SYSTEM_WARNER = 'SISTEMA';

export interface AutoWarningDeps {
  db: {
    addWarning(chatId: string, warning: UserWarning): number;
    clearWarnings(chatId: string, userId: string): number;
  };
  conn: Pick<WASocket, 'sendMessage' | 'groupParticipantsUpdate'>;
  metadata?: Pick<GroupMetadata, 'participants'> | null;
  maxWarnings: number;
}

export interface AutoWarningResult {
  /** Jid canónico sobre el que se registró la advertencia. */
  target: string;
  count: number;
  max: number;
  /** true si alcanzó el máximo y la expulsión fue aceptada. */
  kicked: boolean;
  /** true si alcanzó el máximo pero WhatsApp rechazó la expulsión (el conteo se conserva). */
  kickFailed: boolean;
}

/**
 * Advertencia automática (antilink, antispam, antibad): registra el warn como
 * SISTEMA, avisa con mención y expulsa al llegar al máximo. No depende del
 * handler para que pueda usarse desde él y desde pruebas.
 */
export async function applyAutoWarning(
  deps: AutoWarningDeps,
  chat: string,
  sender: string,
  reason: string,
): Promise<AutoWarningResult> {
  const { db, conn, maxWarnings } = deps;
  const target = canonicalJid(deps.metadata, sender);
  const count = db.addWarning(chat, { odBy: SYSTEM_WARNER, odTo: target, reason, timestamp: Date.now() });
  const tag = mentionTag(target);

  if (count < maxWarnings) {
    await conn.sendMessage(chat, {
      text: `⚠️ ${tag} advertencia ${count}/${maxWarnings}: ${reason}.`,
      mentions: [target],
    });
    return { target, count, max: maxWarnings, kicked: false, kickFailed: false };
  }

  const kicked = await removeParticipant(conn, chat, target);
  if (kicked) {
    db.clearWarnings(chat, target);
    await conn.sendMessage(chat, {
      text: `🚫 ${tag} expulsado por acumular ${maxWarnings} advertencias (${reason}).`,
      mentions: [target],
    });
  } else {
    await conn.sendMessage(chat, {
      text: `⚠️ ${tag} llegó a ${count}/${maxWarnings} advertencias pero no pude expulsarlo (¿es admin?).`,
      mentions: [target],
    });
  }
  return { target, count, max: maxWarnings, kicked, kickFailed: !kicked };
}
