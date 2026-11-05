import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { parseBet, debitBet, creditWin, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS, getCasino } from '../lib/games/state.js';
import { enter, requireRegistered, rollInt, isCompact, infoPlugin, type GameInfo } from '../lib/games/common.js';

export interface SlotSymbol {
  emoji: string;
  name: string;
  weight: number;
  /** Triple paga bet*mult; par paga bet*mult/2. */
  mult: number;
}

/** RTP teórico con estos pesos: ~0.87 (ver tests/juegos-slot.test.ts). */
export const SLOT_SYMBOLS: readonly SlotSymbol[] = [
  { emoji: '🍒', name: 'Cereza', weight: 30, mult: 2 },
  { emoji: '🍋', name: 'Limón', weight: 25, mult: 3 },
  { emoji: '🍊', name: 'Naranja', weight: 20, mult: 4 },
  { emoji: '🍇', name: 'Uvas', weight: 15, mult: 5 },
  { emoji: '🔔', name: 'Campana', weight: 10, mult: 7 },
  { emoji: '💎', name: 'Diamante', weight: 7, mult: 10 },
  { emoji: '7️⃣', name: 'Siete', weight: 5, mult: 15 },
  { emoji: '⭐', name: 'Estrella', weight: 3, mult: 25 },
];

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
const JACKPOT_SYMBOL = '⭐';
const COOLDOWN_MS = 3_000;
const GAME = 'slot';

/** Índice de símbolo según peso; `rng` devuelve un entero en [0, TOTAL_WEIGHT). */
export function spinReel(rng: () => number = () => rollInt(0, TOTAL_WEIGHT - 1)): number {
  let r = rng();
  for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
    r -= SLOT_SYMBOLS[i].weight;
    if (r < 0) return i;
  }
  return SLOT_SYMBOLS.length - 1;
}

export function spinReels(rng?: () => number): [number, number, number] {
  return [spinReel(rng), spinReel(rng), spinReel(rng)];
}

export interface SlotOutcome {
  kind: 'triple' | 'par' | 'nada';
  /** Lo que recibe el jugador (0 si pierde). */
  payout: number;
  symbol: SlotSymbol | null;
}

export function evaluate(bet: number, reels: [number, number, number]): SlotOutcome {
  const [a, b, c] = reels;
  if (a === b && b === c) return { kind: 'triple', payout: bet * SLOT_SYMBOLS[a].mult, symbol: SLOT_SYMBOLS[a] };
  const pair = a === b ? a : b === c ? b : a === c ? a : -1;
  if (pair >= 0) return { kind: 'par', payout: Math.floor((bet * SLOT_SYMBOLS[pair].mult) / 2), symbol: SLOT_SYMBOLS[pair] };
  return { kind: 'nada', payout: 0, symbol: null };
}

/** Simula `spins` giros y devuelve pagado/apostado (sin jackpot). */
export function simulateRtp(spins: number, bet = 100, rng?: () => number): number {
  let paid = 0;
  for (let i = 0; i < spins; i++) paid += evaluate(bet, spinReels(rng)).payout;
  return paid / (spins * bet);
}

export const SLOT_INFO: GameInfo = {
  key: 'slot', name: 'Tragamonedas', emoji: '🎰', play: 'slot 500', casino: true,
  rules: [
    '{p}slot <apuesta>: tres rodillos. Tres iguales paga apuesta × multiplicador; dos iguales paga la mitad.',
    ...SLOT_SYMBOLS.map((s) => `${s.emoji} ${s.name}: ×${s.mult} (par ×${s.mult / 2})`),
    'Jackpot progresivo: 1 % de cada apuesta perdida se acumula y lo cobra el próximo triple ⭐.',
    `Apuesta: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}; acepta 5k, todo, mitad. 3 s entre giros.`,
  ],
};

const lastSpin = new Map<string, number>();
const streaks = new Map<string, number>();

export const slotPlugin: PluginHandler = {
  command: ['slot', 'tragamonedas'],
  description: 'Tragamonedas con jackpot progresivo',
  category: 'casino',
  usage: ['slot 500', 'slot 5k', 'slot todo'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    const { m } = ctx;
    const now = Date.now();
    const last = lastSpin.get(m.sender) ?? 0;
    if (now - last < COOLDOWN_MS) {
      await m.react('⏳');
      return;
    }
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const bet = parseBet(ctx.args[0], { balance: user.money });
    if (!bet.ok) {
      await m.reply(`❌ ${bet.reason}`);
      return;
    }
    if (!debitBet(db, m.sender, bet.amount, GAME)) {
      await m.reply('❌ No te alcanza para esa apuesta.');
      return;
    }
    lastSpin.set(m.sender, now);

    const reels = spinReels();
    const outcome = evaluate(bet.amount, reels);
    const casino = getCasino(db);
    let jackpot = 0;
    if (outcome.kind === 'nada') {
      casino.jackpot += Math.floor(bet.amount * CASINO_LIMITS.jackpotShare);
      db.markDirty();
    } else if (outcome.kind === 'triple' && outcome.symbol?.emoji === JACKPOT_SYMBOL && casino.jackpot > 0) {
      jackpot = casino.jackpot;
      casino.jackpot = 0;
    }
    if (outcome.payout + jackpot > 0) creditWin(db, m.sender, outcome.payout + jackpot, GAME);

    const net = outcome.payout + jackpot - bet.amount;
    const streak = net > 0 ? (streaks.get(m.sender) ?? 0) + 1 : 0;
    streaks.set(m.sender, streak);

    const display = `🎰 │ ${reels.map((i) => SLOT_SYMBOLS[i].emoji).join(' │ ')} │`;
    let line: string;
    if (outcome.kind === 'triple') line = `🎉 ¡Triple ${outcome.symbol?.name}! ×${outcome.symbol?.mult}`;
    else if (outcome.kind === 'par') line = `✨ Par de ${outcome.symbol?.name} ×${(outcome.symbol?.mult ?? 0) / 2}`;
    else line = '💨 Nada esta vez.';
    if (jackpot > 0) line += `\n🌟 ¡JACKPOT! +${formatCoins(jackpot)}`;

    const netText = `${net >= 0 ? '+' : '-'}${Math.abs(net).toLocaleString('es-MX')}`;
    if (isCompact(ctx)) {
      await m.reply(`${display} ${netText} 💰${jackpot > 0 ? ' 🌟 JACKPOT' : ''}`);
      return;
    }
    const extra = [
      streak >= 2 ? `🔥 racha ×${streak}` : null,
      casino.jackpot > 0 ? `🏺 jackpot: ${formatCoins(casino.jackpot)}` : null,
    ].filter(Boolean).join(' · ');
    await m.reply(`${display}\n${line}\n\n${netText} 💰 → saldo ${formatCoins(db.getUser(m.sender).money)}${extra ? `\n${extra}` : ''}`);
  },
};

export const slotInfoPlugin = infoPlugin(SLOT_INFO, ['slotinfo', 'slotayuda']);

export function registerSlot(handler: MessageHandler): void {
  handler.registerPlugin('game-slot', slotPlugin);
  handler.registerPlugin('game-slot-info', slotInfoPlugin);
}
