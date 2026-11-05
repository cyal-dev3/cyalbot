import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { createLogger } from '../lib/logger.js';
import { GameSessionManager, activeGameOf } from '../lib/games/session.js';
import { creditPrize, formatCoins } from '../lib/games/bets.js';
import { CASINO_LIMITS } from '../lib/games/state.js';
import {
  enter, requireRegistered, requireGroup, say, sleep, isRegistered, noPrefixOnly, Cooldown, declareContext, attachContexts, type GameInfo,
} from '../lib/games/common.js';
import { nextWord, localWord, normalizeWord } from '../lib/ai-games.js';
import { PALABRAS_CATEGORIAS } from '../constants/palabras.js';

const log = createLogger('ahorcado');

const GAME = 'ahorcado';
const LIVES = 6;
const TIMEOUT_MS = 3 * 60_000;
/** Si la IA no responde en este tiempo, la partida sale con el banco local. */
const PREPARE_MS = 20_000;
const LETTER_PRIZE = 20;
const WORD_PRIZE = 500;

const DRAWINGS = [
  '  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========',
  '  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========',
];

export const AHORCADO_INFO: GameInfo = {
  key: 'ahorcado', name: 'Ahorcado', emoji: '🪢', play: 'ahorcado', casino: false,
  rules: [
    '{p}ahorcado [categoría]: palabra oculta con pista. Escribe letras sueltas sin prefijo.',
    'Para arriesgar la palabra completa: {p}ahorcado <palabra> (con prefijo, para que la charla normal no cuente).',
    `${LIVES} vidas para todo el grupo. Letra correcta: ${LETTER_PRIZE} 💰; quien completa la palabra: ${WORD_PRIZE} 💰.`,
    `Se cierra tras ${TIMEOUT_MS / 60_000} min sin jugadas. Una partida cada ${CASINO_LIMITS.minigameCooldownMs / 60_000} min por grupo; premios de minijuegos hasta ${CASINO_LIMITS.dailyPrizeCap.toLocaleString('es-MX')} 💰 por persona y día.`,
    `Categorías locales: ${PALABRAS_CATEGORIAS.join(', ')}.`,
  ],
};

interface HangmanState {
  word: string;
  hint: string;
  categoria: string;
  guessed: Set<string>;
  wrong: number;
}

const games = new GameSessionManager<never, HangmanState, 'preparando' | 'jugando'>({ game: GAME, label: 'Ahorcado' });
const cooldown = new Cooldown(CASINO_LIMITS.minigameCooldownMs);

export function maskWord(word: string, guessed: Set<string>): string {
  return [...word].map((ch) => (guessed.has(ch) ? ch.toUpperCase() : '_')).join(' ');
}

function boardText(st: HangmanState): string {
  const wrongLetters = [...st.guessed].filter((l) => !st.word.includes(l)).sort().join(' ');
  return `\`\`\`${DRAWINGS[st.wrong]}\`\`\`\n${maskWord(st.word, st.guessed)}\n💡 ${st.hint}\n❤️ ${LIVES - st.wrong} · ❌ ${wrongLetters || '-'}`;
}

function armTimeout(groupId: string): void {
  games.setTimer(groupId, TIMEOUT_MS, async () => {
    const s = games.get(groupId);
    if (!s) return;
    games.close(groupId);
    await say(groupId, `⏰ Nadie siguió jugando. La palabra era *${s.state.word.toUpperCase()}*.`);
  });
}

async function startGame(ctx: MessageContext, categoria: string | undefined): Promise<void> {
  const groupId = ctx.m.chat;
  const busy = activeGameOf(groupId, ['trivia', 'ahorcado']);
  if (busy) {
    await ctx.m.reply(`Ya hay ${busy} en curso aquí. Espera a que termine.`);
    return;
  }
  const wait = cooldown.remaining(groupId);
  if (wait > 0) {
    await ctx.m.reply(`El próximo ahorcado de este grupo puede empezar en ${Cooldown.text(wait)}.`);
    return;
  }
  // La sesión se crea antes de pedir la palabra (la IA puede tardar): así un
  // segundo `ahorcado` o una `trivia` no se cuelan mientras se prepara.
  const state: HangmanState = { word: '', hint: '', categoria: '', guessed: new Set(), wrong: 0 };
  const session = games.create(groupId, { phase: 'preparando', state });
  if (!session) {
    await ctx.m.reply('Demasiadas partidas abiertas ahora mismo.');
    return;
  }
  try {
    const picked = await Promise.race([nextWord(categoria), sleep(PREPARE_MS).then(() => localWord(categoria))]);
    if (!games.isCurrent(session)) return;
    state.word = normalizeWord(picked.palabra);
    state.hint = picked.pista;
    state.categoria = picked.categoria;
  } catch (error) {
    log.error(`${groupId}: no se pudo obtener una palabra:`, error);
    games.close(groupId);
    await ctx.m.reply('🪢 No pude preparar una palabra ahora mismo. Intenta de nuevo en un momento.');
    return;
  }
  games.setPhase(groupId, 'jugando');
  cooldown.mark(groupId);
  armTimeout(groupId);
  await ctx.m.reply(`🪢 *Ahorcado* · ${state.categoria}\n${boardText(state)}\n\nEscriban una letra. Palabra completa: *${ctx.usedPrefix}ahorcado <palabra>*.`);
}

/** Arriesgar la palabra completa con prefijo: quien acierta gana, quien falla resta una vida. */
async function guessWord(ctx: MessageContext, st: HangmanState, raw: string): Promise<void> {
  const groupId = ctx.m.chat;
  const guess = normalizeWord(raw);
  if (guess.length !== st.word.length) {
    await ctx.m.reply(`La palabra tiene ${st.word.length} letras.\n${boardText(st)}`);
    return;
  }
  enter(ctx);
  armTimeout(groupId);
  if (guess === st.word) {
    await finishWin(groupId, ctx.m.sender, st, 'adivinó la palabra');
    return;
  }
  const text = await loseLife(groupId, st, `❌ No es "${guess.toUpperCase()}".`);
  if (text) await ctx.m.reply(text);
}

export const ahorcadoPlugin: PluginHandler = {
  command: ['ahorcado', 'hangman'],
  description: 'Ahorcado para el grupo con premios por letra',
  category: 'juegos',
  usage: ['ahorcado', 'ahorcado animales', 'ahorcado <palabra> (arriesgar)'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    if (!(await requireGroup(ctx))) return;
    const s = games.get(ctx.m.chat);
    const arg = ctx.args.join(' ').trim().slice(0, 30);
    if (s?.phase === 'jugando') {
      if (arg) return guessWord(ctx, s.state, arg);
      await ctx.m.reply(`${boardText(s.state)}\n\nEscriban una letra o *${ctx.usedPrefix}ahorcado <palabra>*.`);
      return;
    }
    if (s) {
      await ctx.m.reply('Estoy preparando la palabra, un momento.');
      return;
    }
    return startGame(ctx, arg || undefined);
  },
};

async function finishWin(groupId: string, jid: string, st: HangmanState, how: string): Promise<void> {
  games.close(groupId);
  const db = getDatabase();
  const prize = isRegistered(jid, db) ? creditPrize(db, jid, WORD_PRIZE, GAME) : 0;
  const prizeText = prize > 0 ? `Gana ${formatCoins(prize)}.` : 'Sin premio (no registrado o tope diario alcanzado).';
  await say(groupId, `🎉 ${mentionTag(jid)} ${how}: *${st.word.toUpperCase()}*. ${prizeText}`, [jid]);
}

async function loseLife(groupId: string, st: HangmanState, what: string): Promise<string | null> {
  st.wrong++;
  if (st.wrong >= LIVES) {
    games.close(groupId);
    await say(groupId, `💀 ${what} Se acabaron las vidas. La palabra era *${st.word.toUpperCase()}*.\n\`\`\`${DRAWINGS[LIVES]}\`\`\``);
    return null;
  }
  return `${what}\n${boardText(st)}`;
}

export const letraPlugin: PluginHandler = {
  command: /^[a-zñáéíóúü]$/i,
  description: 'Letra en el ahorcado',
  category: 'juegos',
  async handler(ctx) {
    const groupId = ctx.m.chat;
    const s = games.get(groupId);
    // "y tú?" u "o sea" empiezan por una letra pero son charla.
    if (!s || s.phase !== 'jugando' || ctx.args.length > 0) return;
    const st = s.state;
    const letter = normalizeWord(ctx.command);
    if (letter.length !== 1) return;
    enter(ctx);
    if (st.guessed.has(letter)) {
      await ctx.m.react('🔁');
      return;
    }
    st.guessed.add(letter);
    armTimeout(groupId);
    if (!st.word.includes(letter)) {
      const text = await loseLife(groupId, st, `❌ No hay "${letter.toUpperCase()}".`);
      if (text) await ctx.m.reply(text);
      return;
    }
    const db = getDatabase();
    if ([...st.word].every((ch) => st.guessed.has(ch))) {
      await finishWin(groupId, ctx.m.sender, st, 'completó la palabra');
      return;
    }
    const prize = isRegistered(ctx.m.sender, db) ? creditPrize(db, ctx.m.sender, LETTER_PRIZE, GAME) : 0;
    await ctx.m.reply(`✅ "${letter.toUpperCase()}" sí está${prize > 0 ? ` (+${prize} 💰)` : ''}.\n${boardText(st)}`);
  },
};

const AHORCADO_CONTEXT = declareContext({
  name: 'ahorcado',
  isActive: noPrefixOnly((m) => games.get(m.chat)?.phase === 'jugando'),
  plugins: [letraPlugin],
  noPrefix: true,
});

export function registerAhorcado(handler: MessageHandler): void {
  handler.registerPlugin('game-ahorcado', ahorcadoPlugin);
  attachContexts(handler, [AHORCADO_CONTEXT]);
}
