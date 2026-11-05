import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { parseBet, holdBet, releaseEscrow, refundPlayer, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, edit, sleep, rollInt, declareContext, attachContexts, infoPlugin, type GameInfo,
} from '../lib/games/common.js';
import { mesaPlugin } from './game-mesa.js';

const GAME = 'ruleta';
const BETTING_MS = 30_000;
/** Tiempo mínimo de apuestas antes de que un apostador pueda adelantar el giro. */
const MIN_SPIN_WAIT_MS = 10_000;
const MAX_BETS_PER_PLAYER = 5;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export interface BetType {
  key: string;
  aliases: string[];
  /** Pago a 1: lo que recibe de ganancia por cada moneda apostada. */
  payout: number;
  label: string;
  example: string;
  /** `pick` es el número (pleno), la docena o la columna elegida. */
  wins: (n: number, pick: number) => boolean;
}

/** Única fuente de verdad para parseo, pagos y ayuda. */
export const BET_TYPES: BetType[] = [
  { key: 'pleno', aliases: [], payout: 35, label: 'Pleno (un número 0-36)', example: 'ruleta 17 500', wins: (n, pick) => n === pick },
  { key: 'rojo', aliases: ['red', 'r'], payout: 1, label: 'Rojo', example: 'ruleta rojo 500', wins: (n) => RED.has(n) },
  { key: 'negro', aliases: ['black', 'n'], payout: 1, label: 'Negro', example: 'ruleta negro 500', wins: (n) => n !== 0 && !RED.has(n) },
  { key: 'par', aliases: ['even'], payout: 1, label: 'Par', example: 'ruleta par 500', wins: (n) => n !== 0 && n % 2 === 0 },
  { key: 'impar', aliases: ['odd'], payout: 1, label: 'Impar', example: 'ruleta impar 500', wins: (n) => n % 2 === 1 },
  { key: 'bajo', aliases: ['menor', 'low', '1-18'], payout: 1, label: 'Bajo (1-18)', example: 'ruleta bajo 500', wins: (n) => n >= 1 && n <= 18 },
  { key: 'alto', aliases: ['mayor', 'high', '19-36'], payout: 1, label: 'Alto (19-36)', example: 'ruleta alto 500', wins: (n) => n >= 19 },
  { key: 'docena', aliases: ['d'], payout: 2, label: 'Docena (d1, d2, d3)', example: 'ruleta d2 500', wins: (n, pick) => n !== 0 && Math.ceil(n / 12) === pick },
  { key: 'columna', aliases: ['c', 'col'], payout: 2, label: 'Columna (c1, c2, c3)', example: 'ruleta c1 500', wins: (n, pick) => n !== 0 && ((n - 1) % 3) + 1 === pick },
];

export interface ParsedBet {
  type: BetType;
  pick: number;
}

/** Interpreta el tipo de apuesta: número, palabra o docena/columna con dígito pegado. */
export function parseBetType(raw: string | undefined): ParsedBet | null {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d{1,2}$/.test(text)) {
    const n = parseInt(text, 10);
    return n <= 36 ? { type: BET_TYPES[0], pick: n } : null;
  }
  const grouped = text.match(/^([a-z]+)([1-3])$/);
  if (grouped) {
    const type = BET_TYPES.find((t) => t.payout === 2 && (t.key === grouped[1] || t.aliases.includes(grouped[1])));
    return type ? { type, pick: parseInt(grouped[2], 10) } : null;
  }
  const type = BET_TYPES.find((t) => t.payout === 1 && (t.key === text || t.aliases.includes(text)));
  return type ? { type, pick: 0 } : null;
}

export function numberText(n: number): string {
  const color = n === 0 ? '🟢' : RED.has(n) ? '🔴' : '⚫';
  return `${color} ${n}`;
}

function betLabel(bet: ParsedBet): string {
  if (bet.type.key === 'pleno') return `pleno ${bet.pick}`;
  if (bet.pick) return `${bet.type.key} ${bet.pick}`;
  return bet.type.key;
}

export const RULETA_INFO: GameInfo = {
  key: 'ruleta', name: 'Ruleta europea', emoji: '🎡', play: 'ruleta rojo 500', casino: true,
  rules: [
    '{p}ruleta <tipo> <apuesta>: abre la mesa si no existe y registra tu apuesta. 30 s de apuestas.',
    `Escribe *girar* (sin prefijo) si no quieres esperar (tras ${MIN_SPIN_WAIT_MS / 1000} s de mesa abierta); {p}ruleta salir retira tus apuestas.`,
    ...BET_TYPES.map((t) => `${t.label}: paga ${t.payout}:1 · ej. {p}${t.example}`),
    `Hasta ${MAX_BETS_PER_PLAYER} apuestas por persona y ronda. Apuesta: ${CASINO_LIMITS.minBet} a ${CASINO_LIMITS.maxBet.toLocaleString('es-MX')}.`,
  ],
};

interface PlacedBet {
  bet: ParsedBet;
  amount: number;
}

interface RoulettePlayer {
  pushName: string;
  bets: PlacedBet[];
}

type RoulettePhase = 'apuestas' | 'girando';

const ruleta = new GameSessionManager<RoulettePlayer, { opener: string }, RoulettePhase>({ game: GAME, label: 'Ruleta' });

// ---------------------------------------------------------------------------
// Giro
// ---------------------------------------------------------------------------

async function spin(groupId: string): Promise<void> {
  const s = ruleta.get(groupId);
  if (!s || s.phase === 'girando') return;
  ruleta.clearTimer(groupId);
  if (s.players.size === 0) {
    ruleta.close(groupId);
    await say(groupId, '🎡 Nadie apostó. Mesa cerrada.');
    return;
  }
  ruleta.setPhase(groupId, 'girando');
  const result = rollInt(0, 36);

  const key = await say(groupId, '🎡 La bola gira...');
  for (let i = 0; i < 3; i++) {
    await sleep(900);
    await edit(groupId, key, `🎡 La bola gira... ${numberText(rollInt(0, 36))}`);
  }
  await sleep(900);
  await edit(groupId, key, `🎡 Cayó en *${numberText(result)}*`);

  // Un `cerrarmesa` durante la animación ya reembolsó; la custodia que quede sería de otra mesa.
  if (!ruleta.isCurrent(s)) {
    await say(groupId, '🎡 La mesa se cerró durante el giro; las apuestas fueron devueltas.');
    return;
  }
  const db = getDatabase();
  const pay = new Map<string, number>();
  const lines: string[] = [];
  for (const [jid, player] of s.players) {
    let won = 0;
    let staked = 0;
    for (const placed of player.bets) {
      staked += placed.amount;
      if (placed.bet.type.wins(result, placed.bet.pick)) won += placed.amount * (placed.bet.type.payout + 1);
    }
    if (won > 0) pay.set(jid, won);
    const net = won - staked;
    lines.push(`${mentionTag(jid)}: ${net >= 0 ? '+' : ''}${net.toLocaleString('es-MX')} 💰`);
  }
  releaseEscrow(db, groupId, GAME, { pay });
  const mentions = [...s.players.keys()];
  ruleta.close(groupId);
  await say(groupId, `🎡 *Resultado: ${numberText(result)}*\n${lines.join('\n')}`, mentions);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

function helpText(prefix: string): string {
  const examples = BET_TYPES.map((t) => `• ${t.label}: ${t.payout}:1 → *${prefix}${t.example}*`).join('\n');
  return `🎡 *Ruleta*: ${prefix}ruleta <tipo> <apuesta>\n${examples}\n\nMás detalles: *${prefix}casino ruleta*`;
}

async function placeBet(ctx: MessageContext, typeText: string, amountText: string | undefined): Promise<void> {
  if (!(await requireGroup(ctx))) return;
  const parsed = parseBetType(typeText);
  if (!parsed) {
    await ctx.m.reply(`❌ No entiendo la apuesta "${typeText}".\n\n${helpText(ctx.usedPrefix)}`);
    return;
  }
  const groupId = ctx.m.chat;
  const db = getDatabase();
  const existing = ruleta.get(groupId);
  if (existing?.phase === 'girando') {
    await ctx.m.reply('La bola ya está girando; apuesta en la siguiente ronda.');
    return;
  }
  const player = existing?.players.get(ctx.m.sender);
  if (player && player.bets.length >= MAX_BETS_PER_PLAYER) {
    await ctx.m.reply(`Máximo ${MAX_BETS_PER_PLAYER} apuestas por ronda.`);
    return;
  }
  const bet = parseBet(amountText, { balance: db.getUser(ctx.m.sender).money });
  if (!bet.ok) {
    await ctx.m.reply(`❌ ${bet.reason}`);
    return;
  }

  let opened = false;
  if (!existing) {
    if (!ruleta.create(groupId, { phase: 'apuestas', state: { opener: ctx.m.sender } })) {
      await ctx.m.reply('El casino está lleno ahora mismo, intenta en unos minutos.');
      return;
    }
    ruleta.setTimer(groupId, BETTING_MS, () => spin(groupId));
    opened = true;
  }
  if (!holdBet(db, groupId, ctx.m.sender, bet.amount, GAME, { round: !player })) {
    if (opened) ruleta.close(groupId);
    await ctx.m.reply('❌ No te alcanza para esa apuesta.');
    return;
  }
  if (!player) ruleta.join(groupId, ctx.m.sender, { pushName: ctx.m.pushName, bets: [] });
  ruleta.get(groupId)?.players.get(ctx.m.sender)?.bets.push({ bet: parsed, amount: bet.amount });
  ruleta.touch(groupId);

  const remaining = ruleta.remainingSeconds(groupId);
  const head = opened ? `🎡 *Mesa de ruleta abierta* por ${mentionTag(ctx.m.sender)}.\n` : '';
  await ctx.conn.sendMessage(groupId, {
    text: `${head}${mentionTag(ctx.m.sender)} apuesta ${formatCoins(bet.amount)} a *${betLabel(parsed)}* (paga ${parsed.type.payout}:1).\nGira en ${remaining} s o escribe *girar*.`,
    mentions: [ctx.m.sender],
  }, { quoted: ctx.m.rawMessage });
}

async function withdraw(ctx: MessageContext): Promise<void> {
  const groupId = ctx.m.chat;
  const s = ruleta.get(groupId);
  if (!s || !s.players.has(ctx.m.sender)) {
    await ctx.m.reply('No tienes apuestas en esta mesa.');
    return;
  }
  if (s.phase === 'girando') {
    await ctx.m.reply('La bola ya está girando.');
    return;
  }
  const refunded = refundPlayer(getDatabase(), groupId, ctx.m.sender, GAME);
  ruleta.leave(groupId, ctx.m.sender);
  await ctx.m.reply(`Retiraste tus apuestas: ${formatCoins(refunded)} de vuelta.`);
  if (s.players.size === 0) {
    ruleta.close(groupId);
    await say(groupId, '🎡 Mesa cerrada: no quedó nadie.');
  }
}

export const ruletaPlugin: PluginHandler = {
  command: ['ruleta', 'roulette'],
  description: 'Ruleta europea: apuesta y gira',
  category: 'casino',
  usage: ['ruleta rojo 500', 'ruleta 17 1k', 'ruleta salir'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    const sub = (ctx.args[0] ?? '').toLowerCase();
    if (!sub) {
      await ctx.m.reply(helpText(ctx.usedPrefix));
      return;
    }
    if (sub === 'salir') return withdraw(ctx);
    return placeBet(ctx, sub, ctx.args[1]);
  },
};

export const girarPlugin: PluginHandler = {
  command: ['girar', 'spin'],
  description: 'Girar la ruleta sin esperar',
  category: 'casino',
  async handler(ctx) {
    const s = ruleta.get(ctx.m.chat);
    if (!s) return;
    enter(ctx);
    if (!s.players.has(ctx.m.sender)) {
      await ctx.m.reply('Solo quien apostó puede girar.');
      return;
    }
    const wait = s.createdAt + MIN_SPIN_WAIT_MS - Date.now();
    if (wait > 0) {
      await ctx.m.reply(`Deja que los demás apuesten: podrás girar en ${Math.ceil(wait / 1000)} s.`);
      return;
    }
    await spin(ctx.m.chat);
  },
};

const RULETA_CONTEXT = declareContext({
  name: 'ruleta',
  isActive: (m) => ruleta.has(m.chat),
  plugins: [girarPlugin],
  noPrefix: true,
});

export const ruletaInfoPlugin = infoPlugin(RULETA_INFO, ['ruletainfo', 'rouletteinfo', 'ruletaayuda']);

export function registerRuleta(handler: MessageHandler): void {
  handler.registerPlugin('game-ruleta', ruletaPlugin);
  handler.registerPlugin('game-ruleta-info', ruletaInfoPlugin);
  attachContexts(handler, [RULETA_CONTEXT]);
}

// Exports que plugins/index.ts todavía importa. Alias viejos como atajos del
// comando nuevo; se retiran cuando index.ts pase a registerRuleta.

/** @deprecated `ruleta <tipo> <apuesta>` apuesta directamente */
export const apostarPlugin: PluginHandler = {
  command: ['apostar', 'ap'], category: 'casino', description: 'Atajo de ruleta <tipo> <apuesta>', register: true,
  handler: ruletaPlugin.handler,
};
/** @deprecated `ruleta salir` */
export const ruletaSalirPlugin: PluginHandler = {
  command: ['ruletasalir', 'rsalir', 'cancelarapuesta'], category: 'casino', description: 'Atajo de ruleta salir',
  async handler(ctx) {
    enter(ctx);
    await withdraw(ctx);
  },
};
/** @deprecated `mesa` genérico (game-mesa.ts) */
export const ruletaMesaPlugin: PluginHandler = {
  command: ['ruletastatus', 'mesaruleta'], category: 'casino', description: 'Atajo de mesa', handler: mesaPlugin.handler,
};
