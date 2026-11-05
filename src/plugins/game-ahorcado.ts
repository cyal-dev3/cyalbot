import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager, activeGameOf } from '../lib/games/session.js';
import { creditWin, formatCoins } from '../lib/games/bets.js';
import { enter, requireRegistered, requireGroup, say, declareContext, attachContexts, type GameInfo } from '../lib/games/common.js';
import { nextWord, normalizeWord } from '../lib/ai-games.js';
import { PALABRAS_CATEGORIAS } from '../constants/palabras.js';

const GAME = 'ahorcado';
const LIVES = 6;
const TIMEOUT_MS = 3 * 60_000;
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
    '{p}ahorcado [categoría]: palabra oculta con pista. Escribe letras sueltas sin prefijo; también puedes arriesgar la palabra completa.',
    `${LIVES} vidas para todo el grupo. Letra correcta: ${LETTER_PRIZE} 💰; quien completa la palabra: ${WORD_PRIZE} 💰.`,
    `Se cierra tras ${TIMEOUT_MS / 60_000} min sin jugadas. Categorías locales: ${PALABRAS_CATEGORIAS.join(', ')}.`,
  ],
};

interface HangmanState {
  word: string;
  hint: string;
  categoria: string;
  guessed: Set<string>;
  wrong: number;
}

const games = new GameSessionManager<never, HangmanState, 'jugando'>({ game: GAME, label: 'Ahorcado' });

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

export const ahorcadoPlugin: PluginHandler = {
  command: ['ahorcado', 'hangman'],
  description: 'Ahorcado para el grupo con premios por letra',
  category: 'juegos',
  usage: ['ahorcado', 'ahorcado animales'],
  register: true,
  async handler(ctx) {
    enter(ctx);
    if (!(await requireRegistered(ctx))) return;
    if (!(await requireGroup(ctx))) return;
    const groupId = ctx.m.chat;
    const busy = activeGameOf(groupId, ['trivia', 'ahorcado']);
    if (busy) {
      await ctx.m.reply(`Ya hay ${busy} en curso aquí. Espera a que termine.`);
      return;
    }
    const categoria = ctx.args.join(' ').trim().slice(0, 30) || undefined;
    const picked = await nextWord(categoria);
    const state: HangmanState = { word: normalizeWord(picked.palabra), hint: picked.pista, categoria: picked.categoria, guessed: new Set(), wrong: 0 };
    if (!games.create(groupId, { phase: 'jugando', state })) {
      await ctx.m.reply('Demasiadas partidas abiertas ahora mismo.');
      return;
    }
    armTimeout(groupId);
    await ctx.m.reply(`🪢 *Ahorcado* · ${state.categoria}\n${boardText(state)}\n\nEscriban una letra (o la palabra completa).`);
  },
};

async function finishWin(groupId: string, jid: string, st: HangmanState, how: string): Promise<void> {
  games.close(groupId);
  const db = getDatabase();
  if (db.getUser(jid).registered) creditWin(db, jid, WORD_PRIZE, GAME);
  await say(groupId, `🎉 ${mentionTag(jid)} ${how}: *${st.word.toUpperCase()}*. Gana ${formatCoins(WORD_PRIZE)}.`, [jid]);
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
    if (!s) return;
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
    if (db.getUser(ctx.m.sender).registered) creditWin(db, ctx.m.sender, LETTER_PRIZE, GAME);
    await ctx.m.reply(`✅ "${letter.toUpperCase()}" sí está (+${LETTER_PRIZE} 💰).\n${boardText(st)}`);
  },
};

export const palabraPlugin: PluginHandler = {
  command: /^[a-zñáéíóúü]{3,20}$/i,
  description: 'Arriesgar la palabra en el ahorcado',
  category: 'juegos',
  async handler(ctx) {
    const groupId = ctx.m.chat;
    const s = games.get(groupId);
    if (!s || ctx.args.length > 0) return;
    const st = s.state;
    const guess = normalizeWord(ctx.command);
    // Solo cuenta como intento una palabra del mismo largo: el resto es charla normal.
    if (guess.length !== st.word.length) return;
    enter(ctx);
    armTimeout(groupId);
    if (guess === st.word) {
      await finishWin(groupId, ctx.m.sender, st, 'adivinó la palabra');
      return;
    }
    const text = await loseLife(groupId, st, `❌ No es "${guess.toUpperCase()}".`);
    if (text) await ctx.m.reply(text);
  },
};

const AHORCADO_CONTEXT = declareContext({
  name: 'ahorcado',
  isActive: (m) => games.has(m.chat),
  plugins: [letraPlugin, palabraPlugin],
  noPrefix: true,
});

export function registerAhorcado(handler: MessageHandler): void {
  handler.registerPlugin('game-ahorcado', ahorcadoPlugin);
  attachContexts(handler, [AHORCADO_CONTEXT]);
}
