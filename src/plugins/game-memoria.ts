import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager } from '../lib/games/session.js';
import { creditPrize, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, edit, rollInt, shuffle, isRegistered, noPrefixOnly, Cooldown, declareContext, attachContexts, type GameInfo,
} from '../lib/games/common.js';

const GAME = 'memoria';
const COUNT = 6;
const ANSWER_MS = 30_000;
const PRIZE_PER_LEVEL = 50;
/** El nivel (y con él el premio) deja de subir aquí: 50 × 10 = 500 por ronda como máximo. */
const MAX_LEVEL = 10;
/** Espera por grupo entre rondas, para que el premio no sea una fuente continua de monedas. */
const ROUND_COOLDOWN_MS = 60_000;
const POOL = ['🍎', '🍌', '🍉', '🍇', '🍓', '🥝', '🐶', '🐱', '🐸', '🐵', '🦊', '🐼', '⚽', '🎸', '🚗', '✈️', '🌵', '🌙', '⭐', '🔥', '💎', '🎩', '🧩', '🎈'];

/** Quita el selector de variación para comparar emojis con y sin él. */
export function normalizeEmoji(text: string): string {
  return text.trim().replace(/️/g, '');
}

export function showMsFor(level: number): number {
  return Math.max(4_000, 10_000 - (level - 1) * 1_000);
}

export function nextLevel(level: number): number {
  return Math.min(MAX_LEVEL, level + 1);
}

export const MEMORIA_INFO: GameInfo = {
  key: 'memoria', name: 'Memoria', emoji: '🧠', play: 'memoria', casino: false,
  rules: [
    `{p}memoria: muestro ${COUNT} emojis unos segundos, los oculto y pregunto cuál estaba en una posición.`,
    `Responde con el emoji sin prefijo. El primero que acierte gana ${PRIZE_PER_LEVEL} × nivel (nivel máximo ${MAX_LEVEL}); el nivel del grupo sube con cada acierto.`,
    `Cada nivel muestra los emojis menos tiempo. Un fallo o ${ANSWER_MS / 1000} s sin respuesta reinicia el nivel. Una ronda por minuto y grupo.`,
    `Premios de minijuegos hasta ${CASINO_LIMITS.dailyPrizeCap.toLocaleString('es-MX')} 💰 por persona y día.`,
  ],
};

interface MemoriaState {
  sequence: string[];
  position: number;
  level: number;
  /** Prefijo con el que se lanzó la ronda, para sugerir el siguiente comando. */
  prefix: string;
}

const games = new GameSessionManager<never, MemoriaState, 'mostrando' | 'pregunta'>({ game: GAME, label: 'Memoria' });
const levels = new Map<string, number>();
const cooldown = new Cooldown(ROUND_COOLDOWN_MS);

export const memoriaPlugin: PluginHandler = {
  command: ['memoria', 'memory'],
  description: 'Juego de memoria con emojis para el grupo',
  category: 'juegos',
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    if (!(await requireGroup(ctx))) return;
    const groupId = ctx.m.chat;
    if (games.has(groupId)) {
      await ctx.m.reply('Ya hay una ronda de memoria en curso.');
      return;
    }
    const wait = cooldown.remaining(groupId);
    if (wait > 0) {
      await ctx.m.reply(`La siguiente ronda de memoria puede empezar en ${Cooldown.text(wait)}.`);
      return;
    }
    const level = levels.get(groupId) ?? 1;
    const sequence = shuffle([...POOL]).slice(0, COUNT);
    const state: MemoriaState = { sequence, position: rollInt(1, COUNT), level, prefix: ctx.usedPrefix };
    if (!games.create(groupId, { phase: 'mostrando', state })) {
      await ctx.m.reply('Demasiadas partidas abiertas ahora mismo.');
      return;
    }
    cooldown.mark(groupId);
    const showMs = showMsFor(level);
    const key = await say(groupId, `🧠 *Memoria · nivel ${level}* — memoriza (${showMs / 1000} s):\n\n${sequence.join('  ')}`);
    games.setTimer(groupId, showMs, async () => {
      const s = games.get(groupId);
      if (!s) return;
      games.setPhase(groupId, 'pregunta');
      await edit(groupId, key, `🧠 *Memoria · nivel ${level}*\n\n${'❔  '.repeat(COUNT).trim()}`);
      await say(groupId, `¿Qué emoji estaba en la posición *${s.state.position}*? Responde con el emoji (${ANSWER_MS / 1000} s).`);
      games.setTimer(groupId, ANSWER_MS, async () => {
        const current = games.get(groupId);
        if (!current) return;
        games.close(groupId);
        levels.set(groupId, 1);
        await say(groupId, `⏰ Nadie respondió. Era ${current.state.sequence[current.state.position - 1]}. El nivel vuelve a 1.`);
      });
    });
  },
};

const EMOJI_REGEX = new RegExp(`^(${POOL.map((e) => normalizeEmoji(e)).join('|')})\\uFE0F?$`, 'u');

export const respuestaMemoriaPlugin: PluginHandler = {
  command: EMOJI_REGEX,
  description: 'Responder en memoria',
  category: 'juegos',
  async handler(ctx) {
    const groupId = ctx.m.chat;
    const s = games.get(groupId);
    if (!s || s.phase !== 'pregunta' || ctx.args.length > 0) return;
    enter(ctx);
    const answer = normalizeEmoji(ctx.command);
    const expected = normalizeEmoji(s.state.sequence[s.state.position - 1]);
    const db = getDatabase();
    if (answer !== expected) {
      games.close(groupId);
      levels.set(groupId, 1);
      await ctx.m.reply(`❌ No, era ${s.state.sequence[s.state.position - 1]}. El nivel vuelve a 1.`);
      return;
    }
    games.close(groupId);
    const next = nextLevel(s.state.level);
    levels.set(groupId, next);
    const prize = isRegistered(ctx.m.sender, db) ? creditPrize(db, ctx.m.sender, PRIZE_PER_LEVEL * s.state.level, GAME) : 0;
    const prizeText = prize > 0 ? `Gana ${formatCoins(prize)}.` : 'Sin premio (no registrado o tope diario alcanzado).';
    await ctx.conn.sendMessage(groupId, {
      text: `✅ ${mentionTag(ctx.m.sender)} acertó: ${s.state.sequence[s.state.position - 1]}. ${prizeText} Siguiente ronda: nivel ${next} con *${s.state.prefix}memoria* (en ${ROUND_COOLDOWN_MS / 1000} s).`,
      mentions: [ctx.m.sender],
    }, { quoted: ctx.m.rawMessage });
  },
};

const MEMORIA_CONTEXT = declareContext({
  name: 'memoria',
  isActive: noPrefixOnly((m) => games.get(m.chat)?.phase === 'pregunta'),
  plugins: [respuestaMemoriaPlugin],
  noPrefix: true,
});

export function registerMemoria(handler: MessageHandler): void {
  handler.registerPlugin('game-memoria', memoriaPlugin);
  attachContexts(handler, [MEMORIA_CONTEXT]);
}
