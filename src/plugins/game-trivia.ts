import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { GameSessionManager, activeGameOf } from '../lib/games/session.js';
import { creditWin, formatCoins } from '../lib/games/bets.js';
import { enter, requireRegistered, requireGroup, say, declareContext, attachContexts, type GameInfo } from '../lib/games/common.js';
import { nextTriviaQuestion } from '../lib/ai-games.js';
import { TRIVIA_TEMAS, type TriviaQuestion } from '../constants/trivia.js';

const GAME = 'trivia';
const QUESTION_MS = 30_000;
/** Tras el primer acierto la pregunta se cierra antes para no esperar en vano. */
const GRACE_MS = 10_000;
const PAUSE_MS = 3_000;
const FIRST_PRIZE = 300;
const OTHER_PRIZE = 100;
const SERIES_BONUS = 500;
const MAX_QUESTIONS = 10;
const LETTERS = ['A', 'B', 'C', 'D'];

export const TRIVIA_INFO: GameInfo = {
  key: 'trivia', name: 'Trivia', emoji: '❓', play: 'trivia', casino: false,
  rules: [
    `{p}trivia [tema] [n]: pregunta de opción múltiple; responde con *a*, *b*, *c* o *d* sin prefijo. ${QUESTION_MS / 1000} s.`,
    `Primer acierto: ${FIRST_PRIZE} 💰; los demás aciertos: ${OTHER_PRIZE} 💰. Una respuesta por persona y pregunta.`,
    `{p}trivia <tema> 5 encadena hasta ${MAX_QUESTIONS} preguntas y da ${SERIES_BONUS} 💰 extra al mejor de la serie.`,
    `Temas locales: ${TRIVIA_TEMAS.join(', ')}. Con IA, cualquier tema que escribas.`,
  ],
};

interface TriviaState {
  tema: string | undefined;
  total: number;
  index: number;
  question: TriviaQuestion | null;
  answered: Set<string>;
  firstCorrect: string | null;
  correct: string[];
  scores: Map<string, number>;
  asked: Set<string>;
}

const games = new GameSessionManager<never, TriviaState, 'pregunta' | 'pausa'>({ game: GAME, label: 'Trivia' });

function questionText(s: TriviaState): string {
  const q = s.question as TriviaQuestion;
  const head = s.total > 1 ? `❓ *Trivia ${s.index}/${s.total}*` : '❓ *Trivia*';
  const options = q.opciones.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n');
  return `${head}${s.tema ? ` · ${s.tema}` : ''}\n\n${q.pregunta}\n\n${options}\n\nResponde con la letra. ${QUESTION_MS / 1000} s.`;
}

async function askNext(groupId: string): Promise<void> {
  const s = games.get(groupId);
  if (!s) return;
  const st = s.state;
  st.index++;
  st.question = await nextTriviaQuestion(st.tema, st.asked);
  st.asked.add(st.question.pregunta);
  st.answered = new Set();
  st.firstCorrect = null;
  st.correct = [];
  games.setPhase(groupId, 'pregunta');
  games.setTimer(groupId, QUESTION_MS, () => reveal(groupId));
  await say(groupId, questionText(st));
}

async function reveal(groupId: string): Promise<void> {
  const s = games.get(groupId);
  const q = s?.state.question;
  if (!s || !q) return;
  const st = s.state;
  games.setPhase(groupId, 'pausa');
  const others = st.correct.length - 1;
  const winner = st.firstCorrect
    ? `🥇 ${mentionTag(st.firstCorrect)} +${FIRST_PRIZE} 💰${others > 0 ? ` · ${others} más acertaron (+${OTHER_PRIZE} 💰)` : ''}`
    : 'Nadie acertó.';
  await say(groupId, `✅ Respuesta: *${LETTERS[q.correcta]}) ${q.opciones[q.correcta]}*\n${q.explicacion ? `_${q.explicacion}_\n` : ''}${winner}`, st.firstCorrect ? [st.firstCorrect] : []);

  if (st.index >= st.total) {
    await finishSeries(groupId);
    return;
  }
  games.setTimer(groupId, PAUSE_MS, () => askNext(groupId));
}

async function finishSeries(groupId: string): Promise<void> {
  const s = games.get(groupId);
  if (!s) return;
  const st = s.state;
  games.close(groupId);
  if (st.total <= 1 || st.scores.size === 0) return;
  const ranking = [...st.scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topJid, topScore] = ranking[0];
  const unique = ranking.length === 1 || ranking[1][1] < topScore;
  const lines = ranking.slice(0, 5).map(([jid, pts], i) => `${i + 1}. ${mentionTag(jid)} — ${pts} pts`);
  let text = `🏁 *Fin de la trivia*\n${lines.join('\n')}`;
  if (unique) {
    creditWin(getDatabase(), topJid, SERIES_BONUS, GAME);
    text += `\n\n🏆 ${mentionTag(topJid)} se lleva el bono de ${formatCoins(SERIES_BONUS)}.`;
  } else {
    text += '\n\nEmpate arriba: nadie se lleva el bono.';
  }
  await say(groupId, text, ranking.slice(0, 5).map(([jid]) => jid));
}

export const triviaPlugin: PluginHandler = {
  command: ['trivia', 'pregunta'],
  description: 'Trivia de opción múltiple con premios',
  category: 'juegos',
  usage: ['trivia', 'trivia ciencia', 'trivia historia 5'],
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
    const args = [...ctx.args];
    let total = 1;
    if (args.length > 0 && /^\d{1,2}$/.test(args[args.length - 1])) {
      total = Math.min(MAX_QUESTIONS, Math.max(1, parseInt(args.pop() as string, 10)));
    }
    const tema = args.join(' ').trim().slice(0, 40) || undefined;
    const state: TriviaState = {
      tema, total, index: 0, question: null, answered: new Set(), firstCorrect: null, correct: [], scores: new Map(), asked: new Set(),
    };
    if (!games.create(groupId, { phase: 'pausa', state })) {
      await ctx.m.reply('Demasiadas partidas abiertas ahora mismo.');
      return;
    }
    await askNext(groupId);
  },
};

export const respuestaTriviaPlugin: PluginHandler = {
  command: /^[abcd]$/,
  description: 'Responder la trivia',
  category: 'juegos',
  async handler(ctx) {
    const groupId = ctx.m.chat;
    const s = games.get(groupId);
    const q = s?.state.question;
    if (!s || !q || s.phase !== 'pregunta') return;
    const st = s.state;
    if (st.answered.has(ctx.m.sender)) return;
    enter(ctx);
    st.answered.add(ctx.m.sender);
    games.touch(groupId);
    // La misma reacción para todos: los aciertos se revelan al cerrar la pregunta.
    await ctx.m.react('👀');
    const choice = LETTERS.indexOf(ctx.command.toUpperCase());
    if (choice !== q.correcta) return;
    const db = getDatabase();
    const first = st.firstCorrect === null;
    if (first) {
      st.firstCorrect = ctx.m.sender;
      const remaining = games.remainingSeconds(groupId) * 1000;
      if (remaining > GRACE_MS) games.setTimer(groupId, GRACE_MS, () => reveal(groupId));
    }
    st.correct.push(ctx.m.sender);
    st.scores.set(ctx.m.sender, (st.scores.get(ctx.m.sender) ?? 0) + (first ? 3 : 1));
    if (db.getUser(ctx.m.sender).registered) creditWin(db, ctx.m.sender, first ? FIRST_PRIZE : OTHER_PRIZE, GAME);
  },
};

const TRIVIA_CONTEXT = declareContext({
  name: 'trivia',
  isActive: (m) => games.get(m.chat)?.phase === 'pregunta',
  plugins: [respuestaTriviaPlugin],
  noPrefix: true,
});

export function registerTrivia(handler: MessageHandler): void {
  handler.registerPlugin('game-trivia', triviaPlugin);
  attachContexts(handler, [TRIVIA_CONTEXT]);
}
