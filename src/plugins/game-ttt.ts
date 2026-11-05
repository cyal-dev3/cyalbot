import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { getTargetUser, mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, holdBet, releaseEscrow, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, declareContext, attachContexts, type GameInfo,
} from '../lib/games/common.js';

const GAME = 'ttt';
const ACCEPT_MS = 60_000;
const TURN_MS = 60_000;
const DIGITS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const MARK = { X: '❌', O: '⭕' } as const;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export type Cell = 'X' | 'O' | null;

export function winnerOf(board: Cell[]): Cell {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

export function boardText(board: Cell[]): string {
  const cells = board.map((c, i) => (c ? MARK[c] : DIGITS[i]));
  return [0, 3, 6].map((r) => cells.slice(r, r + 3).join('')).join('\n');
}

export const TTT_INFO: GameInfo = {
  key: 'ttt', name: 'Tres en raya', emoji: '⭕', play: 'ttt @usuario 500', casino: true,
  rules: [
    '{p}ttt @usuario [apuesta]: reto; el rival acepta con *aceptar* (60 s). Sin apuesta también vale.',
    'En tu turno escribe el número de la casilla (1-9) sin prefijo. 60 s por turno; si no juegas, pierdes.',
    'Quien hace línea se lleva el bote; empate devuelve las apuestas.',
    `Apuesta opcional: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}.`,
  ],
};

interface TttState {
  board: Cell[];
  challenger: string;
  target: string;
  bet: number;
}

interface TttPlayer {
  pushName: string;
  mark: 'X' | 'O';
}

const games = new GameSessionManager<TttPlayer, TttState, 'reto' | 'jugando'>({ game: GAME, label: 'Tres en raya' });

async function finish(groupId: string, winner: string | null, reason: string): Promise<void> {
  const s = games.get(groupId);
  if (!s) return;
  const db = getDatabase();
  const mentions = [s.state.challenger, s.state.target];
  let text = `${boardText(s.state.board)}\n\n${reason}`;
  if (s.state.bet > 0) {
    if (winner) {
      releaseEscrow(db, groupId, GAME, { pay: new Map([[winner, s.state.bet * 2]]) });
      text += ` Se lleva ${formatCoins(s.state.bet * 2)}.`;
    } else {
      releaseEscrow(db, groupId, GAME, { refund: true });
      text += ' Apuestas devueltas.';
    }
  }
  games.close(groupId);
  await say(groupId, text, mentions);
}

function armTurn(groupId: string): void {
  games.setTimer(groupId, TURN_MS, async () => {
    const s = games.get(groupId);
    const current = games.current(groupId);
    if (!s || !current) return;
    const other = current === s.state.challenger ? s.state.target : s.state.challenger;
    await finish(groupId, other, `⏰ ${mentionTag(current)} no jugó a tiempo. Gana ${mentionTag(other)}.`);
  });
}

async function challenge(ctx: MessageContext, target: string, betText: string | undefined): Promise<void> {
  if (!(await requireGroup(ctx))) return;
  const groupId = ctx.m.chat;
  if (games.has(groupId)) {
    await ctx.m.reply('Ya hay una partida de tres en raya en este grupo.');
    return;
  }
  const db = getDatabase();
  if (!db.getUser(target).registered) {
    await ctx.m.reply('Esa persona no está registrada en el RPG.');
    return;
  }
  let amount = 0;
  if (betText) {
    const bet = parseBet(betText, { balance: Math.min(db.getUser(ctx.m.sender).money, db.getUser(target).money) });
    if (!bet.ok) {
      await ctx.m.reply(`❌ ${bet.reason} (cuenta el saldo de ambos)`);
      return;
    }
    amount = bet.amount;
  }
  const state: TttState = { board: Array<Cell>(9).fill(null), challenger: ctx.m.sender, target, bet: amount };
  if (!games.create(groupId, { phase: 'reto', state })) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  if (amount > 0 && !holdBet(db, groupId, ctx.m.sender, amount, GAME)) {
    games.close(groupId);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  games.join(groupId, ctx.m.sender, { pushName: ctx.m.pushName, mark: 'X' });
  games.setTimer(groupId, ACCEPT_MS, async () => {
    games.close(groupId, { refund: true });
    await say(groupId, `⭕ ${mentionTag(target)} no aceptó el reto.`, [target]);
  });
  const stake = amount > 0 ? ` por ${formatCoins(amount)}` : '';
  await ctx.conn.sendMessage(groupId, {
    text: `⭕ ${mentionTag(ctx.m.sender)} reta a ${mentionTag(target)} a tres en raya${stake}.\n${mentionTag(target)}: escribe *aceptar* en ${ACCEPT_MS / 1000} s.`,
    mentions: [ctx.m.sender, target],
  }, { quoted: ctx.m.rawMessage });
}

export const aceptarTttPlugin: PluginHandler = {
  command: ['aceptar', 'acepto'],
  description: 'Aceptar un reto de tres en raya',
  category: 'casino',
  async handler(ctx) {
    const s = games.get(ctx.m.chat);
    if (!s || s.phase !== 'reto' || s.state.target !== ctx.m.sender) return;
    enter(ctx);
    if (s.state.bet > 0 && !holdBet(getDatabase(), ctx.m.chat, ctx.m.sender, s.state.bet, GAME, { round: false })) {
      await ctx.m.reply(`Necesitas ${formatCoins(s.state.bet)} para aceptar.`);
      return;
    }
    games.join(ctx.m.chat, ctx.m.sender, { pushName: ctx.m.pushName, mark: 'O' });
    games.setPhase(ctx.m.chat, 'jugando');
    armTurn(ctx.m.chat);
    await ctx.conn.sendMessage(ctx.m.chat, {
      text: `${boardText(s.state.board)}\n\n${MARK.X} ${mentionTag(s.state.challenger)} empieza. Escribe el número de la casilla.`,
      mentions: [s.state.challenger],
    });
  },
};

export const jugadaTttPlugin: PluginHandler = {
  command: /^[1-9]$/,
  description: 'Jugar una casilla en tres en raya',
  category: 'casino',
  async handler(ctx) {
    const groupId = ctx.m.chat;
    const s = games.get(groupId);
    if (!s || s.phase !== 'jugando' || games.current(groupId) !== ctx.m.sender) return;
    enter(ctx);
    const index = parseInt(ctx.command, 10) - 1;
    if (s.state.board[index]) {
      await ctx.m.reply('Esa casilla ya está ocupada.');
      return;
    }
    const me = s.players.get(ctx.m.sender);
    if (!me) return;
    s.state.board[index] = me.mark;

    const winner = winnerOf(s.state.board);
    if (winner) {
      await finish(groupId, ctx.m.sender, `🏆 ${mentionTag(ctx.m.sender)} hace línea y gana.`);
      return;
    }
    if (s.state.board.every((c) => c !== null)) {
      await finish(groupId, null, '🤝 Empate.');
      return;
    }
    const next = games.advance(groupId) ?? games.current(groupId);
    if (!next) return;
    armTurn(groupId);
    await ctx.conn.sendMessage(groupId, {
      text: `${boardText(s.state.board)}\n\nTurno de ${MARK[s.players.get(next)?.mark ?? 'O']} ${mentionTag(next)}.`,
      mentions: [next],
    });
  },
};

export const tttPlugin: PluginHandler = {
  command: ['ttt', 'gato', 'tresenraya'],
  description: 'Tres en raya contra otro jugador, con o sin apuesta',
  category: 'casino',
  usage: ['ttt @usuario', 'ttt @usuario 500'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    const target = getTargetUser(ctx.m);
    if (!target) {
      await ctx.m.reply(`Menciona a tu rival: *${ctx.usedPrefix}ttt @usuario [apuesta]*.`);
      return;
    }
    return challenge(ctx, target, ctx.args.find((a) => !a.startsWith('@')));
  },
};

const TTT_CONTEXT = declareContext({
  name: 'ttt',
  isActive: (m) => {
    const s = games.get(m.chat);
    if (!s) return false;
    if (s.phase === 'reto') return s.state.target === m.sender;
    return games.current(m.chat) === m.sender;
  },
  plugins: [aceptarTttPlugin, jugadaTttPlugin],
  noPrefix: true,
});

export function registerTtt(handler: MessageHandler): void {
  handler.registerPlugin('game-ttt', tttPlugin);
  attachContexts(handler, [TTT_CONTEXT]);
}
