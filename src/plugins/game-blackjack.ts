import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, holdBet, releaseEscrow, refundPlayer, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, playerName, declareContext, attachContexts, infoPlugin, type GameInfo,
} from '../lib/games/common.js';
import {
  type Card, newDeck, handText, handValue, isBlackjack, isBust, dealerPlay, settle, type Outcome,
} from '../lib/games/blackjack.js';
import { mesaPlugin } from './game-mesa.js';

const GAME = 'blackjack';
const JOIN_MS = 20_000;
const TURN_MS = 45_000;

interface BjPlayer {
  hand: Card[];
  bet: number;
  pushName: string;
  done: boolean;
  doubled: boolean;
}

interface BjState {
  deck: Card[];
  dealer: Card[];
  mode: 'solo' | 'mesa';
}

type BjPhase = 'inscripcion' | 'turnos';

const bj = new GameSessionManager<BjPlayer, BjState, BjPhase>({ game: GAME, label: 'Blackjack' });

export const BLACKJACK_INFO: GameInfo = {
  key: 'blackjack', name: 'Blackjack', emoji: '🃏', play: 'bj <apuesta>', casino: true,
  rules: [
    '{p}bj <apuesta>: reparte al instante contra el crupier (o te une a la mesa abierta).',
    '{p}bj mesa <apuesta>: abre una mesa; 20 s para que otros entren con {p}bj <apuesta>.',
    'En tu turno escribe *pedir*, *plantarse* o *doblar* (sin prefijo). 45 s por turno.',
    'As vale 1 u 11. El crupier se planta en 17 (también 17 suave).',
    'Blackjack natural paga 3:2; el natural del crupier gana a cualquier 21 no natural; empate devuelve.',
    'Doblar: solo con 2 cartas, duplica la apuesta y recibes una sola carta.',
    `Apuesta: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}.`,
  ],
};

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

function dealerLine(dealer: Card[], hidden: boolean): string {
  if (hidden) return `Crupier: ${handText([dealer[0]])} 🂠`;
  return `Crupier: ${handText(dealer)} (${handValue(dealer).total})`;
}

function playerLine(jid: string, p: BjPlayer): string {
  const v = handValue(p.hand);
  const flags = [p.doubled && 'doblada', isBlackjack(p.hand) && 'blackjack', isBust(p.hand) && 'se pasó'].filter(Boolean);
  return `${mentionTag(jid)}: ${handText(p.hand)} (${v.total})${flags.length ? ` · ${flags.join(', ')}` : ''} · ${formatCoins(p.bet)}`;
}

function tableView(groupId: string, hiddenDealer: boolean): { text: string; mentions: string[] } {
  const s = bj.get(groupId);
  if (!s) return { text: '', mentions: [] };
  const lines = [dealerLine(s.state.dealer, hiddenDealer)];
  for (const [jid, p] of s.players) lines.push(playerLine(jid, p));
  return { text: lines.join('\n'), mentions: [...s.players.keys()] };
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  blackjack: '🎉 blackjack, cobra 3:2',
  gana: '✅ gana',
  empate: '🤝 empate, recupera su apuesta',
  pierde: '❌ pierde',
};

// ---------------------------------------------------------------------------
// Flujo de la ronda
// ---------------------------------------------------------------------------

function nextPending(groupId: string): string | null {
  const s = bj.get(groupId);
  if (!s) return null;
  for (let i = s.turn; i < s.order.length; i++) {
    const jid = s.order[i];
    if (!s.players.get(jid)?.done) {
      s.turn = i;
      return jid;
    }
  }
  return null;
}

async function startRound(groupId: string): Promise<void> {
  const s = bj.get(groupId);
  if (!s) return;
  if (s.players.size === 0) {
    bj.close(groupId, { refund: true });
    await say(groupId, '🃏 Nadie se sentó. Mesa cerrada.');
    return;
  }
  for (let i = 0; i < 2; i++) {
    for (const p of s.players.values()) p.hand.push(s.state.deck.pop() as Card);
    s.state.dealer.push(s.state.deck.pop() as Card);
  }
  // Los naturales (del crupier o del jugador) no tienen turno.
  const dealerNatural = isBlackjack(s.state.dealer);
  for (const p of s.players.values()) if (dealerNatural || isBlackjack(p.hand)) p.done = true;
  bj.setPhase(groupId, 'turnos');
  s.turn = 0;

  const next = nextPending(groupId);
  if (!next) {
    await finish(groupId);
    return;
  }
  const view = tableView(groupId, true);
  await say(groupId, `🃏 *Blackjack*\n${view.text}`, view.mentions);
  await promptTurn(groupId, next);
}

/**
 * Anuncia el turno (solo en mesa: en solo el jugador ya tiene su mano en la
 * respuesta) y arma el temporizador. `markDone` deja el estado listo antes de
 * cualquier await, así un segundo mensaje del mismo jugador no toca su mano.
 */
async function promptTurn(groupId: string, jid: string): Promise<void> {
  const s = bj.get(groupId);
  const p = s?.players.get(jid);
  if (!s || !p) return;
  armTurnTimer(groupId, jid);
  if (s.players.size > 1 || s.state.mode === 'mesa') {
    const extra = p.hand.length === 2 && !p.doubled ? ', *doblar*' : '';
    const value = handValue(p.hand).total;
    await say(groupId, `👉 Turno de ${mentionTag(jid)}: ${handText(p.hand)} (${value}). Escribe *pedir*, *plantarse*${extra}. ${TURN_MS / 1000} s.`, [jid]);
  }
}

function armTurnTimer(groupId: string, jid: string): void {
  bj.setTimer(groupId, TURN_MS, async () => {
    const s = bj.get(groupId);
    const current = s?.players.get(jid);
    // El turno pudo avanzar mientras el temporizador seguía armado para este jugador.
    if (!s || !current || current.done || bj.current(groupId) !== jid) return;
    markDone(groupId, current);
    await say(groupId, `⏰ ${mentionTag(jid)} tardó demasiado y se planta con ${handValue(current.hand).total}.`, [jid]);
    await proceed(groupId);
  });
}

/** Cierra la mano y pasa el turno de forma síncrona (antes de responder). */
function markDone(groupId: string, p: BjPlayer): void {
  p.done = true;
  bj.clearTimer(groupId);
  nextPending(groupId);
}

async function proceed(groupId: string): Promise<void> {
  const next = nextPending(groupId);
  if (next) {
    await promptTurn(groupId, next);
    return;
  }
  await finish(groupId);
}

async function finish(groupId: string): Promise<void> {
  const s = bj.get(groupId);
  if (!s) return;
  bj.clearTimer(groupId);
  const anyoneStanding = [...s.players.values()].some((p) => !isBust(p.hand));
  if (anyoneStanding) dealerPlay(s.state.dealer, s.state.deck);

  const db = getDatabase();
  const pay = new Map<string, number>();
  const lines: string[] = [dealerLine(s.state.dealer, false), ''];
  for (const [jid, p] of s.players) {
    const result = settle(p.hand, s.state.dealer, p.bet);
    if (result.payout > 0) pay.set(jid, result.payout);
    const net = result.payout - p.bet;
    const netText = net === 0 ? '±0' : `${net > 0 ? '+' : ''}${net.toLocaleString('es-MX')}`;
    lines.push(`${mentionTag(jid)} ${handText(p.hand)} (${handValue(p.hand).total}) → ${OUTCOME_TEXT[result.outcome]} (${netText})`);
  }
  releaseEscrow(db, groupId, GAME, { pay });
  const mentions = [...s.players.keys()];
  const balances = mentions.map((jid) => `${playerName(jid, s.players.get(jid)?.pushName, db)}: ${formatCoins(db.getUser(jid).money)}`);
  bj.close(groupId);
  await say(groupId, `🃏 *Resultado*\n${lines.join('\n')}\n\n💰 ${balances.join(' · ')}`, mentions);
}

// ---------------------------------------------------------------------------
// Comandos de entrada
// ---------------------------------------------------------------------------

async function openTable(ctx: MessageContext, betText: string | undefined): Promise<void> {
  if (!(await requireGroup(ctx))) return;
  const groupId = ctx.m.chat;
  if (bj.has(groupId)) {
    await ctx.m.reply(`Ya hay una mesa aquí. Únete con *${ctx.usedPrefix}bj <apuesta>* o mira *${ctx.usedPrefix}mesa*.`);
    return;
  }
  const db = getDatabase();
  const bet = parseBet(betText, { balance: db.getUser(ctx.m.sender).money });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason}`);
    return;
  }
  const session = bj.create(groupId, { phase: 'inscripcion', state: { deck: newDeck(), dealer: [], mode: 'mesa' } });
  if (!session) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  if (!holdBet(db, groupId, ctx.m.sender, bet.amount, GAME)) {
    bj.close(groupId);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  bj.join(groupId, ctx.m.sender, { hand: [], bet: bet.amount, pushName: ctx.m.pushName, done: false, doubled: false });
  bj.setTimer(groupId, JOIN_MS, () => startRound(groupId));
  await ctx.conn.sendMessage(groupId, {
    text: `🃏 *Mesa de blackjack abierta* por ${mentionTag(ctx.m.sender)} (${formatCoins(bet.amount)}).\nEntra con *${ctx.usedPrefix}bj <apuesta>*. Reparto en ${JOIN_MS / 1000} s.`,
    mentions: [ctx.m.sender],
  }, { quoted: ctx.m.rawMessage });
}

async function joinTable(ctx: MessageContext, betText: string | undefined): Promise<void> {
  const groupId = ctx.m.chat;
  const s = bj.get(groupId);
  if (!s) return;
  if (s.phase !== 'inscripcion') {
    await ctx.m.reply(`La mesa ya está en juego (${bj.remainingSeconds(groupId)} s de turno). Espera a que termine.`);
    return;
  }
  if (bj.isPlayerIn(groupId, ctx.m.sender)) {
    await ctx.m.reply('Ya estás sentado. Espera el reparto.');
    return;
  }
  const db = getDatabase();
  const bet = parseBet(betText, { balance: db.getUser(ctx.m.sender).money });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason}`);
    return;
  }
  if (!holdBet(db, groupId, ctx.m.sender, bet.amount, GAME)) {
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  bj.join(groupId, ctx.m.sender, { hand: [], bet: bet.amount, pushName: ctx.m.pushName, done: false, doubled: false });
  await ctx.m.reply(`🪑 Sentado con ${formatCoins(bet.amount)}. Jugadores: ${s.players.size}. Reparto en ${bj.remainingSeconds(groupId)} s.`);
}

async function playSolo(ctx: MessageContext, betText: string | undefined): Promise<void> {
  const chat = ctx.m.chat;
  const db = getDatabase();
  const bet = parseBet(betText, { balance: db.getUser(ctx.m.sender).money });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason}`);
    return;
  }
  const session = bj.create(chat, { phase: 'inscripcion', state: { deck: newDeck(), dealer: [], mode: 'solo' } });
  if (!session) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  if (!holdBet(db, chat, ctx.m.sender, bet.amount, GAME)) {
    bj.close(chat);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  bj.join(chat, ctx.m.sender, { hand: [], bet: bet.amount, pushName: ctx.m.pushName, done: false, doubled: false });
  await startRound(chat);
  const s = bj.get(chat);
  if (!s) return;
  const p = s.players.get(ctx.m.sender);
  if (p && !p.done) {
    const extra = p.hand.length === 2 ? ', *doblar*' : '';
    await ctx.m.reply(`Tu turno: *pedir*, *plantarse*${extra} (${TURN_MS / 1000} s).`);
  }
}

async function leaveTable(ctx: MessageContext): Promise<void> {
  const groupId = ctx.m.chat;
  const s = bj.get(groupId);
  if (!s || !bj.isPlayerIn(groupId, ctx.m.sender)) {
    await ctx.m.reply('No estás en ninguna mesa.');
    return;
  }
  if (s.phase !== 'inscripcion') {
    await ctx.m.reply('La ronda ya empezó; termina tu mano.');
    return;
  }
  const refunded = refundPlayer(getDatabase(), groupId, ctx.m.sender, GAME);
  bj.leave(groupId, ctx.m.sender);
  await ctx.m.reply(`Te levantaste de la mesa; se te devuelven ${formatCoins(refunded)}.`);
  if (s.players.size === 0) {
    bj.close(groupId);
    await say(groupId, '🃏 Mesa cerrada: no quedó nadie.');
  }
}

export const bjPlugin: PluginHandler = {
  command: ['bj', 'blackjack'],
  description: 'Blackjack contra el crupier, solo o en mesa',
  category: 'casino',
  usage: ['bj <apuesta>', 'bj mesa <apuesta>', 'bj salir'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    const sub = (ctx.args[0] ?? '').toLowerCase();
    if (sub === 'mesa') return openTable(ctx, ctx.args[1]);
    if (sub === 'salir') return leaveTable(ctx);
    if (bj.has(ctx.m.chat)) return joinTable(ctx, ctx.args[0]);
    return playSolo(ctx, ctx.args[0]);
  },
};

// ---------------------------------------------------------------------------
// Acciones en turno (contexto sin prefijo)
// ---------------------------------------------------------------------------

async function currentPlayer(ctx: MessageContext): Promise<BjPlayer | null> {
  const s = bj.get(ctx.m.chat);
  if (!s || s.phase !== 'turnos' || ctx.args.length > 0) return null;
  const p = s.players.get(ctx.m.sender);
  if (!p) return null;
  if (bj.current(ctx.m.chat) !== ctx.m.sender || p.done) {
    await ctx.m.reply(p.done ? 'Ya terminaste tu mano.' : 'Aún no es tu turno.');
    return null;
  }
  enter(ctx);
  return p;
}

export const pedirPlugin: PluginHandler = {
  command: ['pedir', 'carta'],
  description: 'Pedir carta en blackjack',
  category: 'casino',
  async handler(ctx) {
    const p = await currentPlayer(ctx);
    const s = bj.get(ctx.m.chat);
    if (!p || !s) return;
    p.hand.push(s.state.deck.pop() as Card);
    const value = handValue(p.hand).total;
    if (isBust(p.hand) || value === 21) {
      markDone(ctx.m.chat, p);
      await ctx.m.reply(isBust(p.hand) ? `💥 ${handText(p.hand)} (${value}). Te pasaste.` : `✨ ${handText(p.hand)} (21). Te plantas.`);
      await proceed(ctx.m.chat);
      return;
    }
    // Solo se rearma el temporizador: la mano ya va en la respuesta, sin repetir el aviso de turno.
    armTurnTimer(ctx.m.chat, ctx.m.sender);
    await ctx.m.reply(`${handText(p.hand)} (${value}). ¿*pedir* o *plantarse*?`);
  },
};

export const plantarsePlugin: PluginHandler = {
  command: ['plantarse', 'plantar', 'quedar', 'pasar', 'stand'],
  description: 'Plantarse en blackjack',
  category: 'casino',
  async handler(ctx) {
    const p = await currentPlayer(ctx);
    if (!p) return;
    markDone(ctx.m.chat, p);
    await ctx.m.reply(`🛑 Te plantas con ${handValue(p.hand).total}.`);
    await proceed(ctx.m.chat);
  },
};

export const doblarPlugin: PluginHandler = {
  command: ['doblar', 'double'],
  description: 'Doblar la apuesta en blackjack (solo con 2 cartas)',
  category: 'casino',
  async handler(ctx) {
    const p = await currentPlayer(ctx);
    const s = bj.get(ctx.m.chat);
    if (!p || !s) return;
    if (p.hand.length !== 2 || p.doubled) {
      await ctx.m.reply('Solo puedes doblar con tus dos primeras cartas.');
      return;
    }
    if (p.bet * 2 > CASINO_LIMITS.maxBet) {
      await ctx.m.reply(`Doblar superaría la apuesta máxima (${formatCoins(CASINO_LIMITS.maxBet)}).`);
      return;
    }
    const db = getDatabase();
    if (!holdBet(db, ctx.m.chat, ctx.m.sender, p.bet, GAME, { round: false })) {
      await ctx.m.reply(`No te alcanza para doblar (necesitas ${formatCoins(p.bet)} más).`);
      return;
    }
    p.bet *= 2;
    p.doubled = true;
    p.hand.push(s.state.deck.pop() as Card);
    markDone(ctx.m.chat, p);
    const value = handValue(p.hand).total;
    await ctx.m.reply(`💰 Doblaste a ${formatCoins(p.bet)}: ${handText(p.hand)} (${value})${isBust(p.hand) ? '. Te pasaste.' : '.'}`);
    await proceed(ctx.m.chat);
  },
};

const BJ_CONTEXT = declareContext({
  name: 'blackjack',
  isActive: (m) => bj.has(m.chat) && bj.get(m.chat)?.phase === 'turnos',
  plugins: [pedirPlugin, plantarsePlugin, doblarPlugin],
  noPrefix: true,
});

export const bjInfoPlugin = infoPlugin(BLACKJACK_INFO, ['bjinfo', 'blackjackinfo', 'bjayuda']);

export function registerBlackjack(handler: MessageHandler): void {
  handler.registerPlugin('game-bj', bjPlugin);
  handler.registerPlugin('game-bj-info', bjInfoPlugin);
  attachContexts(handler, [BJ_CONTEXT]);
}

// Exports que plugins/index.ts todavía importa. Alias viejos como atajos del
// comando nuevo; se retiran cuando index.ts pase a registerBlackjack.

/** @deprecated usa registerBlackjack */
export const blackjackPlugin = bjPlugin;
/** @deprecated `bj <apuesta>` ya une a la mesa abierta */
export const jugarPlugin: PluginHandler = {
  command: ['jugar', 'unirse', 'entrar'], category: 'casino', description: 'Atajo de bj <apuesta>', register: true,
  handler: bjPlugin.handler,
};
/** @deprecated `bj salir` */
export const bjSalirPlugin: PluginHandler = {
  command: ['bjsalir', 'salirmesa', 'bjleave'], category: 'casino', description: 'Atajo de bj salir',
  async handler(ctx) {
    enter(ctx);
    await leaveTable(ctx);
  },
};
/** @deprecated `mesa` genérico (game-mesa.ts) */
export const bjMesaPlugin: PluginHandler = {
  command: ['bjmesa', 'bjstatus'], category: 'casino', description: 'Atajo de mesa', handler: mesaPlugin.handler,
};
