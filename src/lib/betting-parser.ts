import type { BettingPick, BettingSystem, TipsterStats } from '../types/database.js';
import type { MessageContext } from '../types/message.js';
import type { UserBetting } from '../types/user.js';
import type { BettingStore } from './betting-store.js';
import { MAX_FAVORITE_TIPSTERS } from './betting-store.js';
import { getDatabase } from './database.js';

/**
 * "#NombreTipster" al principio de la primera línea: una letra seguida de al
 * menos dos letras, dígitos, guiones o guiones bajos (así #1 o #ok no cuentan).
 */
export const TIPSTER_REGEX = /^#([\p{L}][\p{L}\p{N}_-]{2,})/u;

export function extractTipsterName(text: string | undefined | null): string | null {
  if (!text) return null;
  const firstLine = text.split('\n')[0].trim();
  const m = firstLine.match(TIPSTER_REGEX);
  return m ? m[1] : null;
}

/** Acepta además el formato histórico "🎫 Nombre"; solo para /pick y /tipster, no para el bridge. */
export function extractTipsterNameLegacy(text: string | undefined | null): string | null {
  const modern = extractTipsterName(text);
  if (modern) return modern;
  if (!text) return null;
  const m = text.match(/🎫\s*([^\n]+)/);
  return m ? m[1].trim() || null : null;
}

const SEP = '──────────────────────';
export const BETTING_SEPARATOR = SEP;

// ---------------------------------------------------------------------------
// Métricas y formato
// ---------------------------------------------------------------------------

export interface TipsterMetrics {
  total: number;
  /** 0-100, con un decimal de precisión implícita (no redondeado) */
  winrate: number;
  /** Porcentaje sobre unidades apostadas */
  roi: number;
  profit: number;
  streak: number;
}

export function tipsterMetrics(t: TipsterStats): TipsterMetrics {
  const total = t.wins + t.losses;
  const profit = t.wonUnits - t.lostUnits;
  return {
    total,
    winrate: total > 0 ? (t.wins / total) * 100 : 0,
    roi: t.totalUnits > 0 ? (profit / t.totalUnits) * 100 : 0,
    profit,
    streak: t.currentStreak,
  };
}

/** "12W - 8L (60.0%)" o "Sin historial". */
export function formatRecord(t: TipsterStats | null | undefined, decimals = 1): string {
  if (!t) return 'Sin historial';
  const m = tipsterMetrics(t);
  if (m.total === 0) return 'Sin historial';
  return `${t.wins}W - ${t.losses}L (${m.winrate.toFixed(decimals)}%)`;
}

export function formatStreak(streak: number): string {
  if (streak > 0) return `🔥 +${streak}`;
  if (streak < 0) return `❄️ ${streak}`;
  return '➖ 0';
}

export function signed(value: number, decimals = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

export function buildTipsterStatCard(tipsterName: string, tipster: TipsterStats | null | undefined): string {
  const displayName = `#${tipsterName.toUpperCase()}`;

  if (!tipster || tipster.wins + tipster.losses === 0) {
    return `${displayName} | 🆕 Nuevo Tipster\n${SEP}\nSin historial aún — sé el primero en seguirlo`;
  }

  const { total, winrate: rawWinrate } = tipsterMetrics(tipster);
  const winrate = Math.round(rawWinrate);

  let nivelEmoji: string;
  let nivelText: string;
  if (winrate < 35) { nivelEmoji = '🚨'; nivelText = 'Tipster Deficiente'; }
  else if (winrate < 45) { nivelEmoji = '⚠️'; nivelText = 'Tipster Regular'; }
  else if (winrate < 55) { nivelEmoji = '📈'; nivelText = 'Tipster Promedio'; }
  else if (winrate < 65) { nivelEmoji = '💪'; nivelText = 'Tipster Bueno'; }
  else if (winrate < 75) { nivelEmoji = '🏆'; nivelText = 'Tipster Experto'; }
  else { nivelEmoji = '🌟'; nivelText = 'Tipster Élite'; }

  const streak = tipster.currentStreak;
  const BOXES = 8;
  let rachaStr: string;
  if (streak > 0) {
    const n = Math.min(streak, BOXES);
    rachaStr = '🟩'.repeat(n) + '⬜'.repeat(BOXES - n);
  } else if (streak < 0) {
    const n = Math.min(Math.abs(streak), BOXES);
    rachaStr = '🟥'.repeat(n) + '⬜'.repeat(BOXES - n);
  } else {
    rachaStr = '⬜'.repeat(BOXES);
  }

  return (
    `${displayName} | 💎 ${winrate}% Win Rate\n` +
    `${SEP}\n` +
    `✅ G: ${tipster.wins}  |  ❌ P: ${tipster.losses}  |  🏁 Total: ${total}\n` +
    `📊 Racha: ${rachaStr}\n` +
    `${nivelEmoji} Nivel: ${nivelText}`
  );
}

/** Lista de favoritos de un usuario con record, ROI, racha y pendientes, ordenada por winrate. */
export function renderFavoriteTipsters(
  betting: UserBetting,
  system: BettingSystem,
  options: { title?: string; usedPrefix?: string; showNotify?: boolean } = {},
): string {
  const prefix = options.usedPrefix ?? '/';
  const title = options.title ?? 'TUS TIPSTERS FAVORITOS';
  let msg = `🎫 ${title} (${betting.favoriteTipsters.length}/${MAX_FAVORITE_TIPSTERS})\n${SEP}\n\n`;

  const known = betting.favoriteTipsters
    .map((norm) => system.tipsters[norm])
    .filter((t): t is TipsterStats => Boolean(t))
    .sort((a, b) => tipsterMetrics(b).winrate - tipsterMetrics(a).winrate);
  const unknown = betting.favoriteTipsters.filter((norm) => !system.tipsters[norm]);

  for (const t of known) {
    const m = tipsterMetrics(t);
    msg += `• *${t.name}*\n`;
    msg += `   ${formatRecord(t)} · ROI ${signed(m.roi)}% · ${formatStreak(m.streak)}`;
    if (t.pending > 0) msg += ` · ⏳ ${t.pending}`;
    msg += '\n';
  }
  for (const norm of unknown) msg += `• ${norm} _(sin datos en este grupo)_\n`;

  const { totalFollowed, wonFollowed, lostFollowed } = betting.stats;
  const resolved = wonFollowed + lostFollowed;
  msg += `\n📈 Picks seguidos: ${totalFollowed} · ✅ ${wonFollowed} · ❌ ${lostFollowed}`;
  if (resolved > 0) msg += ` · ${((wonFollowed / resolved) * 100).toFixed(1)}% de acierto`;

  if (options.showNotify) {
    msg += `\n🔔 Avisos: ${betting.notifyOnFavorite ? 'activados' : 'desactivados'} (*${prefix}tipster avisos* para cambiar)`;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Ayudas para los comandos
// ---------------------------------------------------------------------------

/**
 * Devuelve el sistema de betting del grupo si está activo; si no, avisa en el
 * chat y devuelve null para que el comando termine ahí.
 */
export async function requireBetting(ctx: Pick<MessageContext, 'm' | 'usedPrefix' | 'isAdmin' | 'isOwner'>): Promise<BettingSystem | null> {
  const system = getDatabase().betting.peekBettingSystem(ctx.m.chat);
  if (system?.enabled) return system;
  const hint = ctx.isAdmin || ctx.isOwner
    ? `Actívalo con *${ctx.usedPrefix}betting on*.`
    : 'Pídele a un admin que lo active con betting on.';
  await ctx.m.reply(`❌ El sistema de betting no está habilitado en este grupo. ${hint}`);
  return null;
}

/** Lista numerada de picks pendientes para que el usuario elija por número o id. */
export function describePendingPicks(picks: BettingPick[], usedPrefix: string, command: string): string {
  if (picks.length === 0) return `📋 No hay picks pendientes. Registra uno respondiendo a un mensaje con *${usedPrefix}pick*.`;
  const lines = picks.slice(0, 15).map((p, i) => `${i + 1}. *${p.tipsterOriginal}* · ${p.units}u · id ${p.id.slice(-8)}`);
  const more = picks.length > 15 ? `\n… y ${picks.length - 15} más` : '';
  return `📋 ¿Cuál? Hay ${picks.length} picks pendientes:\n${lines.join('\n')}${more}\n\nUsa *${usedPrefix}${command} <número>*, *${usedPrefix}${command} <id>* o responde al mensaje del pick.`;
}

/**
 * Localiza un pick pendiente: por mensaje citado, por número de la lista de
 * pendientes, por los últimos caracteres del id (mínimo 4) o por tipster.
 * Devuelve null si no hay candidato o si hay más de uno (el comando lista los pendientes).
 */
export function findPickFromContext(
  store: BettingStore,
  chatId: string,
  quotedMsgId: string | null | undefined,
  text: string | undefined,
): BettingPick | null {
  if (quotedMsgId) {
    const byQuote = store.getPickByMessageId(chatId, quotedMsgId);
    if (byQuote) return byQuote;
  }

  const pending = store.getPendingPicks(chatId);
  const needle = (text ?? '').trim().toLowerCase();

  if (!needle) {
    return pending.length === 1 ? pending[0] : null;
  }

  if (/^\d{1,2}$/.test(needle)) {
    const index = parseInt(needle, 10) - 1;
    return pending[index] ?? null;
  }

  if (needle.length >= 4) {
    const byId = pending.filter((p) => p.id.toLowerCase().endsWith(needle));
    if (byId.length === 1) return byId[0];
    if (byId.length > 1) return null;
  }

  const normalized = store.normalizeTipsterName(needle);
  if (!normalized) return null;
  const byTipster = pending.filter((p) => p.tipster === normalized);
  return byTipster.length === 1 ? byTipster[0] : null;
}
