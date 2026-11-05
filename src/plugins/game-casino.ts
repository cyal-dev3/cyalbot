import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { normalizeText } from '../lib/utils.js';
import { houseEdge, formatCoins } from '../lib/games/bets.js';
import { getCasino } from '../lib/games/state.js';
import { enter, rulesText, type GameInfo } from '../lib/games/common.js';
import { SLOT_INFO, registerSlot } from './game-slot.js';
import { BLACKJACK_INFO, registerBlackjack } from './game-blackjack.js';
import { RULETA_INFO, registerRuleta } from './game-roulette.js';
import { DADOS_INFO, registerDados } from './game-dados.js';
import { PPT_INFO, registerPpt } from './game-ppt.js';
import { ADIVINA_INFO, registerAdivina } from './game-adivina.js';
import { TTT_INFO, registerTtt } from './game-ttt.js';
import { CARRERA_INFO, registerCarrera } from './game-carrera.js';
import { TRIVIA_INFO, registerTrivia } from './game-trivia.js';
import { AHORCADO_INFO, registerAhorcado } from './game-ahorcado.js';
import { MEMORIA_INFO, registerMemoria } from './game-memoria.js';
import { registerMesa } from './game-mesa.js';

export const GAMES: GameInfo[] = [
  SLOT_INFO, BLACKJACK_INFO, RULETA_INFO, DADOS_INFO, PPT_INFO, ADIVINA_INFO, TTT_INFO, CARRERA_INFO,
  TRIVIA_INFO, AHORCADO_INFO, MEMORIA_INFO,
];

export function findGame(raw: string): GameInfo | undefined {
  const key = normalizeText(raw).trim();
  return GAMES.find((g) => g.key === key || normalizeText(g.name) === key || normalizeText(g.name).startsWith(key));
}

/** `casino` lista los juegos; `casino <juego>` muestra sus reglas. */
export const casinoPlugin: PluginHandler = {
  command: ['casino', 'juegos'],
  description: 'Lista de juegos y reglas de cada uno',
  category: 'casino',
  usage: ['casino', 'casino ruleta'],
  async handler(ctx) {
    enter(ctx);
    const prefix = ctx.usedPrefix || '/';
    if (ctx.args[0]) {
      const game = findGame(ctx.args.join(' '));
      if (!game) {
        await ctx.m.reply(`No conozco ese juego. Juegos: ${GAMES.map((g) => g.key).join(', ')}.`);
        return;
      }
      await ctx.m.reply(rulesText(game, prefix));
      return;
    }
    const casino = GAMES.filter((g) => g.casino).map((g) => `${g.emoji} *${g.name}* → ${prefix}${g.play}`);
    const minis = GAMES.filter((g) => !g.casino).map((g) => `${g.emoji} *${g.name}* → ${prefix}${g.play}`);
    const jackpot = getCasino(getDatabase()).jackpot;
    await ctx.m.reply(
      `🎰 *Casino*\n${casino.join('\n')}\n\n🎲 *Minijuegos*\n${minis.join('\n')}\n\n`
      + `Reglas: *${prefix}casino <juego>* · Mesa activa: *${prefix}mesa*`
      + (jackpot > 0 ? `\n🏺 Jackpot del slot: ${formatCoins(jackpot)}` : ''),
    );
  },
};

/** Margen de la casa por juego, para el owner. */
export const casinoStatsPlugin: PluginHandler = {
  command: ['casinostats'],
  description: 'Estadísticas del casino (margen de la casa por juego)',
  category: 'casino',
  owner: true,
  async handler(ctx) {
    enter(ctx);
    const db = getDatabase();
    const rows = houseEdge(db);
    const casino = getCasino(db);
    if (rows.length === 0) {
      await ctx.m.reply('Todavía no hay apuestas registradas.');
      return;
    }
    const lines = rows.map((r) =>
      `• ${r.game}: ${r.rounds} rondas · apostado ${r.wagered.toLocaleString('es-MX')} · pagado ${r.paid.toLocaleString('es-MX')} · margen ${(r.edge * 100).toFixed(1)} %`);
    const total = rows.reduce((acc, r) => ({ wagered: acc.wagered + r.wagered, paid: acc.paid + r.paid }), { wagered: 0, paid: 0 });
    const edge = total.wagered > 0 ? ((total.wagered - total.paid) / total.wagered) * 100 : 0;
    await ctx.m.reply(
      `📊 *Casino*\n${lines.join('\n')}\n\nTotal: margen ${edge.toFixed(1)} % sobre ${total.wagered.toLocaleString('es-MX')} apostado`
      + `\n🏺 Jackpot: ${formatCoins(casino.jackpot)} · en custodia: ${casino.escrow.length} apuestas`,
    );
  },
};

/** Juegos con apuestas: plugins de entrada, mesa/cerrarmesa, casino y contextos. */
export function registerCasino(handler: MessageHandler): void {
  handler.registerPlugin('game-casino', casinoPlugin);
  handler.registerPlugin('game-casinostats', casinoStatsPlugin);
  registerMesa(handler);
  registerSlot(handler);
  registerBlackjack(handler);
  registerRuleta(handler);
  registerDados(handler);
  registerPpt(handler);
  registerAdivina(handler);
  registerTtt(handler);
  registerCarrera(handler);
}

/** Minijuegos sin apuesta (premios en monedas). */
export function registerMinijuegos(handler: MessageHandler): void {
  registerTrivia(handler);
  registerAhorcado(handler);
  registerMemoria(handler);
}
