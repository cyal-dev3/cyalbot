import type { Database } from '../database.js';
import { parseAmount } from '../utils.js';
import { createLogger } from '../logger.js';
import { CASINO_LIMITS, getCasino, gameStats } from './state.js';

const log = createLogger('casino');

export type BetResult = { ok: true; amount: number } | { ok: false; reason: string };

export interface ParseBetOptions {
  min?: number;
  max?: number;
  balance: number;
  /** Apuesta a usar cuando el texto viene vacío. Sin fallback, vacío es error. */
  fallback?: number;
}

export function formatCoins(n: number): string {
  return `${Math.floor(n).toLocaleString('es-MX')} 💰`;
}

/** Palabras y porcentajes que se calculan sobre el saldo del jugador. */
const RELATIVE_AMOUNT = /^(todo|all|max|maximo|máximo|mitad|half|\d{1,3}%)$/i;

/**
 * Interpreta la apuesta escrita por el usuario (solo enteros, sufijos k/m,
 * todo/all/mitad/porcentaje sobre el saldo) y la valida contra límites y saldo.
 */
export function parseBet(text: string | undefined, options: ParseBetOptions): BetResult {
  const min = options.min ?? CASINO_LIMITS.minBet;
  const max = options.max ?? CASINO_LIMITS.maxBet;
  const raw = (text ?? '').trim();
  let amount: number | null;
  if (!raw) {
    if (options.fallback === undefined) return { ok: false, reason: `Indica cuánto apuestas (mínimo ${formatCoins(min)}).` };
    amount = options.fallback;
  } else if (raw.includes('.')) {
    return { ok: false, reason: `"${raw}" no es una apuesta válida: solo enteros (500, 2k), sin decimales.` };
  } else if (RELATIVE_AMOUNT.test(raw)) {
    // "todo"/"mitad"/"50%" van sobre el saldo y se acotan al máximo de la mesa en vez de rechazarse.
    const relative = parseAmount(raw, options.balance);
    amount = relative === null ? null : Math.min(relative, max);
  } else {
    amount = parseAmount(raw);
  }
  if (amount === null || !Number.isInteger(amount)) {
    return { ok: false, reason: `"${raw}" no es una apuesta válida. Ejemplos: 500, 2k, todo, mitad.` };
  }
  if (amount < min) return { ok: false, reason: `La apuesta mínima es ${formatCoins(min)}.` };
  if (amount > max) return { ok: false, reason: `La apuesta máxima es ${formatCoins(max)}.` };
  if (amount > options.balance) {
    return { ok: false, reason: `No te alcanza: tienes ${formatCoins(options.balance)} y quieres apostar ${formatCoins(amount)}.` };
  }
  return { ok: true, amount };
}

/** Cobra la apuesta al usuario. Devuelve false (sin tocar nada) si no le alcanza. */
export function debitBet(db: Database, jid: string, amount: number, game: string, options: { round?: boolean } = {}): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  const user = db.getUser(jid);
  if (user.money < amount) return false;
  db.updateUser(jid, { money: user.money - amount });
  const stats = gameStats(db, game);
  stats.wagered += amount;
  if (options.round !== false) stats.rounds += 1;
  db.markDirty();
  return true;
}

/** Paga un premio (lo que el jugador recibe, incluida su apuesta si se devuelve). */
export function creditWin(db: Database, jid: string, amount: number, game: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const paid = Math.floor(amount);
  const user = db.getUser(jid);
  db.updateUser(jid, { money: user.money + paid });
  gameStats(db, game).paid += paid;
  db.markDirty();
}

function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Lo que el jugador aún puede cobrar hoy en premios de minijuegos. */
export function dailyPrizeLeft(db: Database, jid: string): number {
  const entry = getCasino(db).prizes[jid];
  const used = entry && entry.day === localDay() ? entry.total : 0;
  return Math.max(0, CASINO_LIMITS.dailyPrizeCap - used);
}

/**
 * Premio de un minijuego sin apuesta (trivia, ahorcado, memoria, adivina grupo):
 * crea monedas, así que se acota al tope diario por persona. Devuelve lo que se
 * acreditó de verdad (0 si ya alcanzó el tope).
 */
export function creditPrize(db: Database, jid: string, amount: number, game: string): number {
  const credited = Math.min(Math.floor(amount), dailyPrizeLeft(db, jid));
  if (credited <= 0) return 0;
  const casino = getCasino(db);
  const day = localDay();
  // Las entradas de otros días ya no sirven: se purgan para que el mapa no crezca.
  for (const [key, entry] of Object.entries(casino.prizes)) if (entry.day !== day) delete casino.prizes[key];
  const entry = casino.prizes[jid] ?? (casino.prizes[jid] = { day, total: 0 });
  entry.total += credited;
  creditWin(db, jid, credited, game);
  return credited;
}

/** Cobra la apuesta y la deja en custodia hasta que la mesa se resuelva. */
export function holdBet(db: Database, groupId: string, jid: string, amount: number, game: string, options: { round?: boolean } = {}): boolean {
  if (!debitBet(db, jid, amount, game, options)) return false;
  getCasino(db).escrow.push({ groupId, jid, amount, game, at: Date.now() });
  db.markDirty();
  return true;
}

/** Total en custodia de un jugador en una mesa. */
export function heldAmount(db: Database, groupId: string, jid: string, game: string): number {
  return getCasino(db).escrow
    .filter((e) => e.groupId === groupId && e.jid === jid && e.game === game)
    .reduce((sum, e) => sum + e.amount, 0);
}

/** Lo que cada jugador tiene en custodia en esa mesa. */
export function heldByPlayer(db: Database, groupId: string, game: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of getCasino(db).escrow) {
    if (e.groupId !== groupId || e.game !== game) continue;
    out.set(e.jid, (out.get(e.jid) ?? 0) + e.amount);
  }
  return out;
}

export type EscrowOutcome = { pay: Map<string, number> } | { refund: true };

/**
 * Cierra la custodia de una mesa: con `pay`, cada jugador recibe lo indicado
 * (0 o ausente = perdió); con `refund`, todos recuperan lo que pusieron.
 * Devuelve cuántas entradas se liberaron.
 */
export function releaseEscrow(db: Database, groupId: string, game: string, outcome: EscrowOutcome): number {
  const casino = getCasino(db);
  const mine = casino.escrow.filter((e) => e.groupId === groupId && e.game === game);
  if (mine.length === 0) return 0;
  casino.escrow = casino.escrow.filter((e) => !(e.groupId === groupId && e.game === game));

  if ('refund' in outcome) {
    const stats = gameStats(db, game);
    for (const e of mine) {
      const user = db.getUser(e.jid);
      db.updateUser(e.jid, { money: user.money + e.amount });
      // Un reembolso no es una apuesta jugada: se descuenta de lo apostado.
      stats.wagered = Math.max(0, stats.wagered - e.amount);
    }
  } else {
    for (const [jid, amount] of outcome.pay) creditWin(db, jid, amount, game);
  }
  db.markDirty();
  return mine.length;
}

/** Devuelve a un solo jugador lo que tenía en custodia en esa mesa (se retira antes de empezar). */
export function refundPlayer(db: Database, groupId: string, jid: string, game: string): number {
  const casino = getCasino(db);
  const mine = casino.escrow.filter((e) => e.groupId === groupId && e.jid === jid && e.game === game);
  if (mine.length === 0) return 0;
  casino.escrow = casino.escrow.filter((e) => !mine.includes(e));
  const total = mine.reduce((sum, e) => sum + e.amount, 0);
  const user = db.getUser(jid);
  db.updateUser(jid, { money: user.money + total });
  const stats = gameStats(db, game);
  stats.wagered = Math.max(0, stats.wagered - total);
  stats.rounds = Math.max(0, stats.rounds - 1);
  db.markDirty();
  return total;
}

/** Reembolsa toda la custodia pendiente (mesas que quedaron abiertas al reiniciar). */
export function refundAllEscrow(db: Database): number {
  const casino = getCasino(db);
  const pending = casino.escrow;
  if (pending.length === 0) return 0;
  casino.escrow = [];
  for (const e of pending) {
    const user = db.getUser(e.jid);
    db.updateUser(e.jid, { money: user.money + e.amount });
    const stats = gameStats(db, e.game);
    stats.wagered = Math.max(0, stats.wagered - e.amount);
  }
  db.markDirty();
  return pending.length;
}

/** Llamar tras initDatabase: devuelve el dinero de mesas interrumpidas. */
export function restoreCasino(db: Database): void {
  const refunded = refundAllEscrow(db);
  if (refunded > 0) log.info(`${refunded} apuestas en custodia reembolsadas al arrancar`);
}

/** Margen de la casa por juego a partir de las estadísticas acumuladas. */
export function houseEdge(db: Database): { game: string; wagered: number; paid: number; rounds: number; edge: number }[] {
  return Object.entries(getCasino(db).stats)
    .map(([game, s]) => ({ game, ...s, edge: s.wagered > 0 ? (s.wagered - s.paid) / s.wagered : 0 }))
    .sort((a, b) => b.wagered - a.wagered);
}
