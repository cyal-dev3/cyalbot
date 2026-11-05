import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { getTargetUser, mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, debitBet, creditWin, holdBet, releaseEscrow, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, edit, sleep, rollInt, playerName, declareContext, attachContexts, type GameInfo,
} from '../lib/games/common.js';

const GAME = 'dados';
const ACCEPT_MS = 60_000;
/** Margen de la casa en apuestas a número exacto. */
const HOUSE_EDGE = 0.08;
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** Formas de sumar n con dos dados. */
export function waysToRoll(n: number): number {
  if (n < 2 || n > 12) return 0;
  return 6 - Math.abs(n - 7);
}

/** Lo que recibe (apuesta incluida) por moneda apostada al número exacto n. */
export function exactMultiplier(n: number): number {
  const ways = waysToRoll(n);
  if (ways === 0) return 0;
  return Math.round((36 / ways) * (1 - HOUSE_EDGE) * 100) / 100;
}

export type DiceChoice = 'alto' | 'bajo' | number;

export function parseChoice(raw: string | undefined): DiceChoice | null {
  const text = (raw ?? '').trim().toLowerCase();
  if (['alto', 'high', 'mayor'].includes(text)) return 'alto';
  if (['bajo', 'low', 'menor'].includes(text)) return 'bajo';
  if (/^\d{1,2}$/.test(text)) {
    const n = parseInt(text, 10);
    return n >= 2 && n <= 12 ? n : null;
  }
  return null;
}

/** Pago (apuesta incluida) para una suma dada. alto/bajo 1:1, 7 pierde. */
export function dicePayout(bet: number, choice: DiceChoice, sum: number): number {
  if (choice === 'alto') return sum >= 8 ? bet * 2 : 0;
  if (choice === 'bajo') return sum <= 6 ? bet * 2 : 0;
  return sum === choice ? Math.floor(bet * exactMultiplier(choice)) : 0;
}

export const DADOS_INFO: GameInfo = {
  key: 'dados', name: 'Dados', emoji: '🎲', play: 'dados 500 alto', casino: true,
  rules: [
    '{p}dados <apuesta> alto|bajo: dos dados; alto (8-12) y bajo (2-6) pagan 1:1, el 7 pierde.',
    '{p}dados <apuesta> <2-12>: número exacto, paga según probabilidad (p. ej. 7 → ×' + exactMultiplier(7) + ', 2 → ×' + exactMultiplier(2) + ').',
    '{p}dados @usuario <apuesta>: duelo al mejor de 3 tiradas; el rival acepta con *aceptar*. El ganador se lleva todo.',
    `Apuesta: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}.`,
  ],
};

function diceText(a: number, b: number): string {
  return `${DICE[a - 1]}${DICE[b - 1]} (${a + b})`;
}

// ---------------------------------------------------------------------------
// Contra la casa
// ---------------------------------------------------------------------------

async function playHouse(ctx: MessageContext, betText: string | undefined, choiceText: string | undefined): Promise<void> {
  const choice = parseChoice(choiceText);
  if (!choice) {
    await ctx.m.reply(`Elige *alto*, *bajo* o un número del 2 al 12. Ej: ${ctx.usedPrefix}dados 500 alto`);
    return;
  }
  const db = getDatabase();
  const bet = parseBet(betText, { balance: db.getUser(ctx.m.sender).money });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason}`);
    return;
  }
  if (!debitBet(db, ctx.m.sender, bet.amount, GAME)) {
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  const a = rollInt(1, 6);
  const b = rollInt(1, 6);
  const payout = dicePayout(bet.amount, choice, a + b);
  if (payout > 0) creditWin(db, ctx.m.sender, payout, GAME);
  const net = payout - bet.amount;
  const label = typeof choice === 'number' ? `al ${choice}` : `a ${choice}`;
  await ctx.m.reply(
    `🎲 ${diceText(a, b)} — apostaste ${label}\n${payout > 0 ? '✅ Ganaste' : '❌ Perdiste'}: ${net >= 0 ? '+' : ''}${net.toLocaleString('es-MX')} 💰 → saldo ${formatCoins(db.getUser(ctx.m.sender).money)}`,
  );
}

// ---------------------------------------------------------------------------
// Duelo al mejor de 3
// ---------------------------------------------------------------------------

interface DuelPlayer {
  pushName: string;
  wins: number;
}

const duels = new GameSessionManager<DuelPlayer, { challenger: string; target: string; bet: number }, 'reto' | 'tirando'>({
  game: GAME, label: 'Duelo de dados',
});

async function challenge(ctx: MessageContext, target: string, betText: string | undefined): Promise<void> {
  if (!(await requireGroup(ctx))) return;
  const groupId = ctx.m.chat;
  if (duels.has(groupId)) {
    await ctx.m.reply('Ya hay un duelo de dados pendiente en este grupo.');
    return;
  }
  const db = getDatabase();
  if (!db.getUser(target).registered) {
    await ctx.m.reply('Esa persona no está registrada en el RPG.');
    return;
  }
  const bet = parseBet(betText, { balance: Math.min(db.getUser(ctx.m.sender).money, db.getUser(target).money) });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason} (cuenta el saldo de ambos)`);
    return;
  }
  if (!duels.create(groupId, { phase: 'reto', state: { challenger: ctx.m.sender, target, bet: bet.amount } })) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  if (!holdBet(db, groupId, ctx.m.sender, bet.amount, GAME)) {
    duels.close(groupId);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  duels.join(groupId, ctx.m.sender, { pushName: ctx.m.pushName, wins: 0 });
  duels.setTimer(groupId, ACCEPT_MS, async () => {
    duels.close(groupId, { refund: true });
    await say(groupId, `🎲 ${mentionTag(target)} no aceptó el duelo. Apuesta devuelta.`, [target]);
  });
  await ctx.conn.sendMessage(groupId, {
    text: `🎲 ${mentionTag(ctx.m.sender)} reta a ${mentionTag(target)} a dados por ${formatCoins(bet.amount)} (mejor de 3).\n${mentionTag(target)}: escribe *aceptar* en ${ACCEPT_MS / 1000} s.`,
    mentions: [ctx.m.sender, target],
  }, { quoted: ctx.m.rawMessage });
}

async function runDuel(groupId: string): Promise<void> {
  const s = duels.get(groupId);
  if (!s) return;
  const { challenger, target, bet } = s.state;
  const names = new Map<string, string>();
  for (const [jid, p] of s.players) names.set(jid, playerName(jid, p.pushName));
  const lines: string[] = [`🎲 *Duelo de dados* — ${names.get(challenger)} vs ${names.get(target)}`];
  const key = await say(groupId, lines.join('\n'));

  const a = s.players.get(challenger);
  const b = s.players.get(target);
  if (!a || !b) return;
  let round = 0;
  while (a.wins < 2 && b.wins < 2 && round < 9) {
    round++;
    await sleep(1500);
    const ra = [rollInt(1, 6), rollInt(1, 6)];
    const rb = [rollInt(1, 6), rollInt(1, 6)];
    const sa = ra[0] + ra[1];
    const sb = rb[0] + rb[1];
    let verdict = 'empate, se repite';
    if (sa > sb) {
      a.wins++;
      verdict = `punto para ${names.get(challenger)}`;
    } else if (sb > sa) {
      b.wins++;
      verdict = `punto para ${names.get(target)}`;
    }
    lines.push(`Ronda ${round}: ${diceText(ra[0], ra[1])} vs ${diceText(rb[0], rb[1])} → ${verdict} (${a.wins}-${b.wins})`);
    await edit(groupId, key, lines.join('\n'));
  }

  const db = getDatabase();
  const winner = a.wins > b.wins ? challenger : b.wins > a.wins ? target : null;
  if (winner) {
    releaseEscrow(db, groupId, GAME, { pay: new Map([[winner, bet * 2]]) });
    await say(groupId, `🏆 ${mentionTag(winner)} gana el duelo y se lleva ${formatCoins(bet * 2)}.`, [winner]);
  } else {
    releaseEscrow(db, groupId, GAME, { refund: true });
    await say(groupId, '🤝 Empate tras 9 rondas. Apuestas devueltas.');
  }
  duels.close(groupId);
}

export const aceptarDadosPlugin: PluginHandler = {
  command: ['aceptar', 'acepto'],
  description: 'Aceptar un duelo de dados',
  category: 'casino',
  async handler(ctx) {
    const s = duels.get(ctx.m.chat);
    if (!s || s.phase !== 'reto' || s.state.target !== ctx.m.sender) return;
    enter(ctx);
    const db = getDatabase();
    if (!holdBet(db, ctx.m.chat, ctx.m.sender, s.state.bet, GAME, { round: false })) {
      await ctx.m.reply(`Necesitas ${formatCoins(s.state.bet)} para aceptar.`);
      return;
    }
    duels.clearTimer(ctx.m.chat);
    duels.setPhase(ctx.m.chat, 'tirando');
    duels.join(ctx.m.chat, ctx.m.sender, { pushName: ctx.m.pushName, wins: 0 });
    await runDuel(ctx.m.chat);
  },
};

export const dadosPlugin: PluginHandler = {
  command: ['dados', 'dice'],
  description: 'Dados contra la casa o duelo al mejor de 3',
  category: 'casino',
  usage: ['dados 500 alto', 'dados 1k 7', 'dados @usuario 500'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    // Solo mención o cita: un número en los argumentos siempre es la apuesta.
    const target = getTargetUser(ctx.m);
    if (target) return challenge(ctx, target, ctx.args.find((a) => !a.startsWith('@')));
    if (ctx.args.length < 2) {
      await ctx.m.reply(`Uso: *${ctx.usedPrefix}dados <apuesta> alto|bajo|<2-12>* o *${ctx.usedPrefix}dados @usuario <apuesta>*.`);
      return;
    }
    return playHouse(ctx, ctx.args[0], ctx.args[1]);
  },
};

const DADOS_CONTEXT = declareContext({
  name: 'dados',
  isActive: (m) => duels.get(m.chat)?.state.target === m.sender,
  plugins: [aceptarDadosPlugin],
  noPrefix: true,
});

export function registerDados(handler: MessageHandler): void {
  handler.registerPlugin('game-dados', dadosPlugin);
  attachContexts(handler, [DADOS_CONTEXT]);
}
