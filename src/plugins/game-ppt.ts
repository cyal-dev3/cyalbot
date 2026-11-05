import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { getTargetUser, mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, debitBet, creditWin, holdBet, releaseEscrow, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, pickOne, playerName, declareContext, attachContexts, type GameInfo,
} from '../lib/games/common.js';

const GAME = 'ppt';
const PHASE_MS = 60_000;

export type Choice = 'piedra' | 'papel' | 'tijera';
const CHOICES: Choice[] = ['piedra', 'papel', 'tijera'];
const EMOJI: Record<Choice, string> = { piedra: '🪨', papel: '📄', tijera: '✂️' };
const CHOICE_WORDS: Record<string, Choice> = {
  p: 'piedra', piedra: 'piedra', rock: 'piedra',
  pa: 'papel', papel: 'papel', paper: 'papel',
  t: 'tijera', tijera: 'tijera', tijeras: 'tijera', scissors: 'tijera',
};
const CHOICE_REGEX = new RegExp(`^(${Object.keys(CHOICE_WORDS).join('|')})$`, 'i');

export function parseChoice(raw: string | undefined): Choice | null {
  return CHOICE_WORDS[(raw ?? '').trim().toLowerCase()] ?? null;
}

/** 1 si gana a, -1 si gana b, 0 empate. */
export function compare(a: Choice, b: Choice): number {
  if (a === b) return 0;
  const wins = (a === 'piedra' && b === 'tijera') || (a === 'tijera' && b === 'papel') || (a === 'papel' && b === 'piedra');
  return wins ? 1 : -1;
}

export const PPT_INFO: GameInfo = {
  key: 'ppt', name: 'Piedra, papel o tijera', emoji: '✂️', play: 'ppt 500 piedra', casino: true,
  rules: [
    '{p}ppt <apuesta> <piedra|papel|tijera>: contra el bot, paga 1:1; empate devuelve.',
    '{p}ppt @usuario <apuesta>: reto al mejor de 3. El rival acepta con *aceptar* (60 s).',
    'Cada ronda, los dos eligen escribiendo *piedra*, *papel* o *tijera* (o p/pa/t) sin prefijo.',
    'Elige por privado al bot para que tu rival no lo vea; si eliges en el grupo, él lo verá.',
    `El ganador se lleva el bote menos ${Math.round(CASINO_LIMITS.duelFee * 100)} % de comisión. Sin respuesta en 60 s: reembolso.`,
  ],
};

// ---------------------------------------------------------------------------
// Contra el bot
// ---------------------------------------------------------------------------

async function playBot(ctx: MessageContext, betText: string | undefined, choiceText: string | undefined): Promise<void> {
  const choice = parseChoice(choiceText);
  if (!choice) {
    await ctx.m.reply(`Elige piedra, papel o tijera. Ej: ${ctx.usedPrefix}ppt 500 piedra`);
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
  const bot = pickOne(CHOICES);
  const result = compare(choice, bot);
  const payout = result > 0 ? bet.amount * 2 : result === 0 ? bet.amount : 0;
  if (payout > 0) creditWin(db, ctx.m.sender, payout, GAME);
  const net = payout - bet.amount;
  const verdict = result > 0 ? '✅ Ganaste' : result === 0 ? '🤝 Empate, te devuelvo la apuesta' : '❌ Perdiste';
  await ctx.m.reply(`${EMOJI[choice]} vs ${EMOJI[bot]} (bot)\n${verdict}: ${net >= 0 ? '+' : ''}${net.toLocaleString('es-MX')} 💰 → saldo ${formatCoins(db.getUser(ctx.m.sender).money)}`);
}

// ---------------------------------------------------------------------------
// Duelo al mejor de 3
// ---------------------------------------------------------------------------

interface PptPlayer {
  pushName: string;
  wins: number;
  choice: Choice | null;
}

interface PptState {
  challenger: string;
  target: string;
  bet: number;
  round: number;
}

const duels = new GameSessionManager<PptPlayer, PptState, 'reto' | 'eleccion'>({ game: GAME, label: 'Duelo de ppt' });

function expire(groupId: string): void {
  duels.setTimer(groupId, PHASE_MS, async () => {
    const s = duels.get(groupId);
    duels.close(groupId, { refund: true });
    if (s) await say(groupId, '✂️ Duelo cancelado por falta de respuesta. Apuestas devueltas.');
  });
}

async function challenge(ctx: MessageContext, target: string, betText: string | undefined): Promise<void> {
  if (!(await requireGroup(ctx))) return;
  const groupId = ctx.m.chat;
  if (duels.has(groupId)) {
    await ctx.m.reply('Ya hay un duelo de ppt en este grupo.');
    return;
  }
  if (duels.findByPlayer(ctx.m.sender) || duels.findByPlayer(target)) {
    await ctx.m.reply('Uno de los dos ya está en otro duelo.');
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
  if (!duels.create(groupId, { phase: 'reto', state: { challenger: ctx.m.sender, target, bet: bet.amount, round: 1 } })) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  if (!holdBet(db, groupId, ctx.m.sender, bet.amount, GAME)) {
    duels.close(groupId);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  duels.join(groupId, ctx.m.sender, { pushName: ctx.m.pushName, wins: 0, choice: null });
  expire(groupId);
  await ctx.conn.sendMessage(groupId, {
    text: `✂️ ${mentionTag(ctx.m.sender)} reta a ${mentionTag(target)} a piedra, papel o tijera por ${formatCoins(bet.amount)} (mejor de 3).\n${mentionTag(target)}: escribe *aceptar* en ${PHASE_MS / 1000} s.`,
    mentions: [ctx.m.sender, target],
  }, { quoted: ctx.m.rawMessage });
}

async function resolveRound(groupId: string): Promise<void> {
  const s = duels.get(groupId);
  if (!s) return;
  const a = s.players.get(s.state.challenger);
  const b = s.players.get(s.state.target);
  if (!a?.choice || !b?.choice) return;
  const result = compare(a.choice, b.choice);
  if (result > 0) a.wins++;
  if (result < 0) b.wins++;
  const verdict = result === 0 ? 'empate' : `punto para ${mentionTag(result > 0 ? s.state.challenger : s.state.target)}`;
  const line = `Ronda ${s.state.round}: ${mentionTag(s.state.challenger)} ${EMOJI[a.choice]} vs ${EMOJI[b.choice]} ${mentionTag(s.state.target)} → ${verdict} (${a.wins}-${b.wins})`;
  const mentions = [s.state.challenger, s.state.target];
  a.choice = null;
  b.choice = null;

  if (a.wins === 2 || b.wins === 2) {
    const winner = a.wins === 2 ? s.state.challenger : s.state.target;
    const pot = s.state.bet * 2;
    const prize = Math.floor(pot * (1 - CASINO_LIMITS.duelFee));
    releaseEscrow(getDatabase(), groupId, GAME, { pay: new Map([[winner, prize]]) });
    duels.close(groupId);
    await say(groupId, `${line}\n\n🏆 ${mentionTag(winner)} gana el duelo y se lleva ${formatCoins(prize)}.`, mentions);
    return;
  }
  if (result !== 0) s.state.round++;
  expire(groupId);
  await say(groupId, `${line}\nSiguiente ronda: elijan de nuevo.`, mentions);
}

export const aceptarPptPlugin: PluginHandler = {
  command: ['aceptar', 'acepto'],
  description: 'Aceptar un duelo de ppt',
  category: 'casino',
  async handler(ctx) {
    const s = duels.get(ctx.m.chat);
    if (!s || s.phase !== 'reto' || s.state.target !== ctx.m.sender) return;
    enter(ctx);
    if (!holdBet(getDatabase(), ctx.m.chat, ctx.m.sender, s.state.bet, GAME, { round: false })) {
      await ctx.m.reply(`Necesitas ${formatCoins(s.state.bet)} para aceptar.`);
      return;
    }
    duels.join(ctx.m.chat, ctx.m.sender, { pushName: ctx.m.pushName, wins: 0, choice: null });
    duels.setPhase(ctx.m.chat, 'eleccion');
    expire(ctx.m.chat);
    await ctx.conn.sendMessage(ctx.m.chat, {
      text: `✂️ ¡Duelo aceptado! ${mentionTag(s.state.challenger)} y ${mentionTag(s.state.target)}: elijan *piedra*, *papel* o *tijera* (aquí o por privado al bot). ${PHASE_MS / 1000} s por ronda.`,
      mentions: [s.state.challenger, s.state.target],
    });
  },
};

export const eleccionPptPlugin: PluginHandler = {
  command: CHOICE_REGEX,
  description: 'Elegir piedra, papel o tijera en un duelo',
  category: 'casino',
  async handler(ctx) {
    const s = duels.findByPlayer(ctx.m.sender);
    if (!s || s.phase !== 'eleccion') return;
    if (ctx.m.isGroup && ctx.m.chat !== s.groupId) return;
    const choice = parseChoice(ctx.command);
    const player = s.players.get(ctx.m.sender);
    if (!choice || !player) return;
    enter(ctx);
    player.choice = choice;
    duels.touch(s.groupId);
    if (ctx.m.isGroup) {
      await ctx.m.react(EMOJI[choice]);
    } else {
      await ctx.m.reply(`Anotado: ${EMOJI[choice]} ${choice}.`);
      await say(s.groupId, `${playerName(ctx.m.sender, ctx.m.pushName)} ya eligió.`);
    }
    await resolveRound(s.groupId);
  },
};

export const pptPlugin: PluginHandler = {
  command: ['ppt', 'piedrapapeltijera', 'rps'],
  description: 'Piedra, papel o tijera contra el bot o en duelo',
  category: 'casino',
  usage: ['ppt 500 piedra', 'ppt @usuario 1k'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    const target = getTargetUser(ctx.m);
    if (target) return challenge(ctx, target, ctx.args.find((a) => !a.startsWith('@')));
    if (ctx.args.length < 2) {
      await ctx.m.reply(`Uso: *${ctx.usedPrefix}ppt <apuesta> piedra|papel|tijera* o *${ctx.usedPrefix}ppt @usuario <apuesta>*.`);
      return;
    }
    return playBot(ctx, ctx.args[0], ctx.args[1]);
  },
};

const PPT_CONTEXT = declareContext({
  name: 'ppt',
  isActive: (m) => {
    const s = duels.findByPlayer(m.sender) ?? duels.get(m.chat);
    if (!s) return false;
    if (s.phase === 'reto') return m.chat === s.groupId && s.state.target === m.sender;
    return s.players.has(m.sender) && (!m.isGroup || m.chat === s.groupId);
  },
  plugins: [aceptarPptPlugin, eleccionPptPlugin],
  noPrefix: true,
});

export function registerPpt(handler: MessageHandler): void {
  handler.registerPlugin('game-ppt', pptPlugin);
  attachContexts(handler, [PPT_CONTEXT]);
}
