import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, holdBet, creditPrize, releaseEscrow, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, rollInt, isRegistered, noPrefixOnly, Cooldown, declareContext, attachContexts, type GameInfo,
} from '../lib/games/common.js';

const GAME = 'adivina';
const MAX_ATTEMPTS = 6;
const SOLO_TIMEOUT_MS = 90_000;
const GROUP_TIMEOUT_MS = 120_000;
const GROUP_PRIZE = 200;

/**
 * Multiplicador según el intento en que se acierta. Con búsqueda binaria el
 * retorno óptimo queda en ~0.97, así que la casa conserva margen incluso
 * contra el jugador perfecto.
 */
export function multiplierFor(attempt: number): number {
  if (attempt <= 2) return 5;
  if (attempt <= 4) return 2;
  if (attempt <= MAX_ATTEMPTS) return 1.2;
  return 0;
}

export const ADIVINA_INFO: GameInfo = {
  key: 'adivina', name: 'Adivina el número', emoji: '🔢', play: 'adivina 500', casino: true,
  rules: [
    `{p}adivina <apuesta>: pienso un número del 1 al 100 y tienes ${MAX_ATTEMPTS} intentos. Escribe el número sin prefijo.`,
    `Aciertas en 1-2 intentos: ×5. En 3-4: ×2. En 5-6: ×1.2. Si no (o si dejas pasar ${SOLO_TIMEOUT_MS / 1000} s sin intentar), pierdes la apuesta.`,
    `{p}adivina grupo: sin apuesta, el primero del grupo que acierte gana ${GROUP_PRIZE} monedas (una ronda cada 5 min).`,
    `Apuesta: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}.`,
  ],
};

interface AdivinaState {
  secret: number;
  attempts: number;
  mode: 'solo' | 'grupo';
  player: string | null;
  bet: number;
  low: number;
  high: number;
}

const games = new GameSessionManager<{ pushName: string }, AdivinaState, 'jugando'>({ game: GAME, label: 'Adivina el número' });
const groupCooldown = new Cooldown(CASINO_LIMITS.minigameCooldownMs);

/**
 * Sin respuesta a tiempo. En solo cuenta como derrota: el jugador controla el
 * ritmo, y con reembolso bastaría con usar solo los intentos que pagan ×5 y
 * dejar expirar el resto para jugar con RTP > 1.
 */
function timeout(chat: string, ms: number): void {
  games.setTimer(chat, ms, async () => {
    const s = games.get(chat);
    if (!s) return;
    if (s.state.mode === 'solo') {
      releaseEscrow(getDatabase(), chat, GAME, { pay: new Map() });
      games.close(chat);
      await say(chat, `⏰ Se acabó el tiempo sin intentar. El número era *${s.state.secret}*; pierdes ${formatCoins(s.state.bet)}.`);
      return;
    }
    games.close(chat);
    await say(chat, `⏰ Nadie adivinó. El número era *${s.state.secret}*.`);
  });
}

async function startSolo(ctx: MessageContext, betText: string | undefined): Promise<void> {
  const chat = ctx.m.chat;
  if (games.has(chat)) {
    await ctx.m.reply('Ya hay una partida de adivina aquí. Espera a que termine.');
    return;
  }
  const db = getDatabase();
  const bet = parseBet(betText, { balance: db.getUser(ctx.m.sender).money });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason}`);
    return;
  }
  const state: AdivinaState = { secret: rollInt(1, 100), attempts: 0, mode: 'solo', player: ctx.m.sender, bet: bet.amount, low: 1, high: 100 };
  if (!games.create(chat, { phase: 'jugando', state })) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  if (!holdBet(db, chat, ctx.m.sender, bet.amount, GAME)) {
    games.close(chat);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  games.join(chat, ctx.m.sender, { pushName: ctx.m.pushName });
  timeout(chat, SOLO_TIMEOUT_MS);
  await ctx.m.reply(`🔢 Pensé un número del 1 al 100. Tienes ${MAX_ATTEMPTS} intentos y ${SOLO_TIMEOUT_MS / 1000} s por intento. Escribe tu número.`);
}

async function startGroup(ctx: MessageContext): Promise<void> {
  if (!(await requireGroup(ctx))) return;
  const chat = ctx.m.chat;
  if (games.has(chat)) {
    await ctx.m.reply('Ya hay una partida de adivina aquí.');
    return;
  }
  const wait = groupCooldown.remaining(chat);
  if (wait > 0) {
    await ctx.m.reply(`La ronda grupal se puede abrir de nuevo en ${Cooldown.text(wait)}.`);
    return;
  }
  const state: AdivinaState = { secret: rollInt(1, 100), attempts: 0, mode: 'grupo', player: null, bet: 0, low: 1, high: 100 };
  if (!games.create(chat, { phase: 'jugando', state })) {
    await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
    return;
  }
  groupCooldown.mark(chat);
  timeout(chat, GROUP_TIMEOUT_MS);
  await ctx.m.reply(`🔢 *Adivina grupal*: número del 1 al 100. El primero que acierte gana ${GROUP_PRIZE} 💰. Escriban números sin prefijo (${GROUP_TIMEOUT_MS / 1000} s).`);
}

export const adivinaPlugin: PluginHandler = {
  command: ['adivina', 'adivinar'],
  description: 'Adivina el número del 1 al 100',
  category: 'casino',
  usage: ['adivina 500', 'adivina grupo'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    if ((ctx.args[0] ?? '').toLowerCase() === 'grupo') return startGroup(ctx);
    return startSolo(ctx, ctx.args[0]);
  },
};

export const intentoPlugin: PluginHandler = {
  command: /^\d{1,3}$/,
  description: 'Intento en adivina',
  category: 'casino',
  async handler(ctx) {
    const chat = ctx.m.chat;
    const s = games.get(chat);
    // "50 pesos" es charla, no un intento.
    if (!s || ctx.args.length > 0) return;
    if (s.state.mode === 'solo' && s.state.player !== ctx.m.sender) return;
    const guess = parseInt(ctx.command, 10);
    if (guess < 1 || guess > 100) return;
    enter(ctx);
    const st = s.state;
    st.attempts++;
    games.touch(chat);
    const db = getDatabase();

    if (guess === st.secret) {
      if (st.mode === 'solo') {
        const payout = Math.floor(st.bet * multiplierFor(st.attempts));
        releaseEscrow(db, chat, GAME, { pay: new Map([[ctx.m.sender, payout]]) });
        games.close(chat);
        await ctx.m.reply(`🎯 ¡Era *${st.secret}*! Acertaste en ${st.attempts} intento${st.attempts === 1 ? '' : 's'}: ×${multiplierFor(st.attempts)} → +${(payout - st.bet).toLocaleString('es-MX')} 💰 (saldo ${formatCoins(db.getUser(ctx.m.sender).money)}).`);
      } else {
        games.close(chat);
        const prize = isRegistered(ctx.m.sender, db) ? creditPrize(db, ctx.m.sender, GROUP_PRIZE, GAME) : 0;
        await ctx.conn.sendMessage(chat, {
          text: `🎯 ${mentionTag(ctx.m.sender)} adivinó: era *${st.secret}*.${prizeText(prize)}`, mentions: [ctx.m.sender],
        }, { quoted: ctx.m.rawMessage });
      }
      return;
    }

    const hint = guess < st.secret ? '⬆️ más alto' : '⬇️ más bajo';
    if (guess < st.secret) st.low = Math.max(st.low, guess + 1);
    else st.high = Math.min(st.high, guess - 1);

    if (st.mode === 'grupo') {
      await ctx.m.reply(`${hint} (entre ${st.low} y ${st.high})`);
      return;
    }
    if (st.attempts >= MAX_ATTEMPTS) {
      releaseEscrow(db, chat, GAME, { pay: new Map() });
      games.close(chat);
      await ctx.m.reply(`💀 Sin intentos. El número era *${st.secret}*. Perdiste ${formatCoins(st.bet)}.`);
      return;
    }
    timeout(chat, SOLO_TIMEOUT_MS);
    await ctx.m.reply(`${hint} · intento ${st.attempts}/${MAX_ATTEMPTS} (entre ${st.low} y ${st.high})`);
  },
};

function prizeText(prize: number): string {
  return prize > 0 ? ` Gana ${prize} 💰.` : ' (sin premio: no registrado o tope diario alcanzado)';
}

const ADIVINA_CONTEXT = declareContext({
  name: 'adivina',
  isActive: noPrefixOnly((m) => {
    const s = games.get(m.chat);
    return Boolean(s && (s.state.mode === 'grupo' || s.state.player === m.sender));
  }),
  plugins: [intentoPlugin],
  noPrefix: true,
});

export function registerAdivina(handler: MessageHandler): void {
  handler.registerPlugin('game-adivina', adivinaPlugin);
  attachContexts(handler, [ADIVINA_CONTEXT]);
}
