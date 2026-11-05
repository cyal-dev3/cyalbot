import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, holdBet, releaseEscrow, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, edit, sleep, rollInt, type GameInfo,
} from '../lib/games/common.js';

const GAME = 'carrera';
const BETTING_MS = 30_000;
const STEPS = 6;
const TRACK = 12;
/** 4 corredores con la misma probabilidad: 3.5x da un RTP de 87.5 %. */
const PAYOUT = 3.5;
const RUNNERS = ['🐢', '🐇', '🐎', '🐕'];

export const CARRERA_INFO: GameInfo = {
  key: 'carrera', name: 'Carrera', emoji: '🏁', play: 'carrera 500 2', casino: true,
  rules: [
    `{p}carrera <apuesta> <1-4>: apuesta a un corredor (${RUNNERS.map((r, i) => `${i + 1} ${r}`).join(', ')}). 30 s de apuestas.`,
    `Los cuatro tienen la misma probabilidad; acertar paga ×${PAYOUT}. Una apuesta por persona y carrera.`,
    `Apuesta: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}.`,
  ],
};

interface RacePlayer {
  pushName: string;
  runner: number;
  amount: number;
}

const races = new GameSessionManager<RacePlayer, { positions: number[] }, 'apuestas' | 'corriendo'>({ game: GAME, label: 'Carrera' });

function trackText(positions: number[]): string {
  return positions.map((pos, i) => {
    const p = Math.min(pos, TRACK);
    return `${i + 1} ${'·'.repeat(p)}${RUNNERS[i]}${'·'.repeat(TRACK - p)}🏁`;
  }).join('\n');
}

export function pickWinner(positions: number[], rng: (max: number) => number): number {
  const best = Math.max(...positions);
  const tied = positions.map((p, i) => (p === best ? i : -1)).filter((i) => i >= 0);
  return tied[rng(tied.length)];
}

async function run(groupId: string): Promise<void> {
  const s = races.get(groupId);
  if (!s) return;
  if (s.players.size === 0) {
    races.close(groupId);
    await say(groupId, '🏁 Nadie apostó. Carrera cancelada.');
    return;
  }
  races.setPhase(groupId, 'corriendo');
  const positions = s.state.positions;
  const key = await say(groupId, `🏁 *¡Arrancan!*\n${trackText(positions)}`);
  for (let step = 1; step <= STEPS; step++) {
    await sleep(1200);
    for (let i = 0; i < positions.length; i++) positions[i] += rollInt(1, 3);
    await edit(groupId, key, `🏁 *Paso ${step}/${STEPS}*\n${trackText(positions)}`);
  }
  const winner = pickWinner(positions, (n) => rollInt(0, n - 1));
  if (!races.isCurrent(s)) {
    await say(groupId, '🏁 La carrera se canceló a mitad (mesa cerrada); las apuestas fueron devueltas.');
    return;
  }

  const db = getDatabase();
  const pay = new Map<string, number>();
  const lines: string[] = [];
  for (const [jid, p] of s.players) {
    const won = p.runner === winner;
    if (won) pay.set(jid, Math.floor(p.amount * PAYOUT));
    const net = won ? Math.floor(p.amount * PAYOUT) - p.amount : -p.amount;
    lines.push(`${mentionTag(jid)} (${RUNNERS[p.runner]}): ${net >= 0 ? '+' : ''}${net.toLocaleString('es-MX')} 💰`);
  }
  releaseEscrow(db, groupId, GAME, { pay });
  const mentions = [...s.players.keys()];
  races.close(groupId);
  await say(groupId, `🏆 Gana ${RUNNERS[winner]} (${winner + 1})\n${lines.join('\n')}`, mentions);
}

export const carreraPlugin: PluginHandler = {
  command: ['carrera', 'race'],
  description: 'Apuesta a un corredor y mira la carrera',
  category: 'casino',
  usage: ['carrera 500 2'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    if (!(await requireGroup(ctx))) return;
    const groupId = ctx.m.chat;
    const runner = parseInt(ctx.args[1] ?? '', 10);
    if (!ctx.args[0] || !(runner >= 1 && runner <= RUNNERS.length)) {
      await ctx.m.reply(`Uso: *${ctx.usedPrefix}carrera <apuesta> <1-4>*. Corredores: ${RUNNERS.map((r, i) => `${i + 1} ${r}`).join(', ')}.`);
      return;
    }
    const existing = races.get(groupId);
    if (existing?.phase === 'corriendo') {
      await ctx.m.reply('La carrera ya empezó; apuesta en la siguiente.');
      return;
    }
    if (existing?.players.has(ctx.m.sender)) {
      await ctx.m.reply('Ya apostaste en esta carrera.');
      return;
    }
    const db = getDatabase();
    const bet = parseBet(ctx.args[0], { balance: db.getUser(ctx.m.sender).money });
    if (!bet.ok) {
      await ctx.m.reply(`❌ ${bet.reason}`);
      return;
    }
    let opened = false;
    if (!existing) {
      if (!races.create(groupId, { phase: 'apuestas', state: { positions: RUNNERS.map(() => 0) } })) {
        await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
        return;
      }
      races.setTimer(groupId, BETTING_MS, () => run(groupId));
      opened = true;
    }
    if (!holdBet(db, groupId, ctx.m.sender, bet.amount, GAME)) {
      if (opened) races.close(groupId);
      await ctx.m.reply('❌ No te alcanza para esa apuesta.');
      return;
    }
    races.join(groupId, ctx.m.sender, { pushName: ctx.m.pushName, runner: runner - 1, amount: bet.amount });
    const head = opened ? '🏁 *Carrera abierta*. ' : '';
    await ctx.conn.sendMessage(groupId, {
      text: `${head}${mentionTag(ctx.m.sender)} apuesta ${formatCoins(bet.amount)} a ${RUNNERS[runner - 1]} (${runner}). Arranca en ${races.remainingSeconds(groupId)} s.`,
      mentions: [ctx.m.sender],
    }, { quoted: ctx.m.rawMessage });
  },
};

export function registerCarrera(handler: MessageHandler): void {
  handler.registerPlugin('game-carrera', carreraPlugin);
}
