import { createLogger } from './logger.js';
import { normalizeText } from './utils.js';
import { TRIVIA_BANK, TRIVIA_TEMAS, type TriviaQuestion } from '../constants/trivia.js';
import { PALABRAS, PALABRAS_CATEGORIAS, type Palabra } from '../constants/palabras.js';
import { pickOne } from './games/common.js';

const log = createLogger('ai-juegos');

const CACHE_LIMIT = 50;
const BATCH = 10;

// ai.ts arrastra el registro completo de plugins; se carga solo cuando hace falta,
// igual que hace el handler.
async function loadAI(): Promise<typeof import('./ai.js')> {
  return import('./ai.js');
}

// ---------------------------------------------------------------------------
// Trivia
// ---------------------------------------------------------------------------

const triviaCache = new Map<string, TriviaQuestion[]>();

function cacheKey(raw: string | undefined): string {
  return normalizeText(raw ?? '').trim() || 'general';
}

function isTriviaQuestion(value: unknown): value is Omit<TriviaQuestion, 'tema'> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.pregunta === 'string' && v.pregunta.length > 5
    && Array.isArray(v.opciones) && v.opciones.length === 4 && v.opciones.every((o) => typeof o === 'string' && o.trim())
    && new Set((v.opciones as string[]).map((o) => o.trim().toLowerCase())).size === 4
    && Number.isInteger(v.correcta) && (v.correcta as number) >= 0 && (v.correcta as number) <= 3;
}

/** Pregunta del banco local, priorizando el tema y evitando las ya usadas. */
export function localTriviaQuestion(tema: string | undefined, exclude: Set<string> = new Set()): TriviaQuestion {
  const key = cacheKey(tema);
  const byTema = TRIVIA_BANK.filter((q) => key !== 'general' && (q.tema === key || normalizeText(q.tema).includes(key)));
  const pool = (byTema.length > 0 ? byTema : TRIVIA_BANK).filter((q) => !exclude.has(q.pregunta));
  return pickOne(pool.length > 0 ? pool : TRIVIA_BANK);
}

async function fillTriviaCache(key: string): Promise<void> {
  const tema = key === 'general' ? 'cultura general variada' : key;
  const { askJSON } = await loadAI();
  const batch = await askJSON<unknown[]>({
    system: 'Generas preguntas de trivia en español, dificultad media, variadas y verificables. '
      + 'Devuelve un arreglo JSON de objetos {"pregunta": string, "opciones": [4 strings distintas], "correcta": índice 0-3, "explicacion": string corta}. '
      + 'Sin numerar las opciones ni repetir preguntas típicas.',
    user: `Genera ${BATCH} preguntas sobre: ${tema}.`,
    maxTokens: 2500,
    effort: 'low',
  });
  if (!Array.isArray(batch)) return;
  const valid = batch.filter(isTriviaQuestion).map((q): TriviaQuestion => ({
    pregunta: q.pregunta.trim(),
    opciones: q.opciones.map((o) => o.trim()) as TriviaQuestion['opciones'],
    correcta: q.correcta,
    explicacion: typeof q.explicacion === 'string' ? q.explicacion.trim() : '',
    tema: (TRIVIA_TEMAS as readonly string[]).includes(key) ? key as TriviaQuestion['tema'] : 'cultura',
  }));
  const current = triviaCache.get(key) ?? [];
  triviaCache.set(key, [...current, ...valid].slice(-CACHE_LIMIT));
  log.debug(`trivia: ${valid.length}/${batch.length} preguntas válidas para "${key}"`);
}

/** Pregunta generada por la IA (con caché por tema) o del banco local si no hay IA. */
export async function nextTriviaQuestion(tema: string | undefined, exclude: Set<string> = new Set()): Promise<TriviaQuestion> {
  const key = cacheKey(tema);
  if ((await loadAI()).isAIEnabled()) {
    try {
      if ((triviaCache.get(key)?.length ?? 0) === 0) await fillTriviaCache(key);
      const cached = triviaCache.get(key) ?? [];
      const index = cached.findIndex((q) => !exclude.has(q.pregunta));
      if (index >= 0) return cached.splice(index, 1)[0];
    } catch (error) {
      log.warn('trivia: fallo la IA, uso el banco local:', error);
    }
  }
  return localTriviaQuestion(tema, exclude);
}

// ---------------------------------------------------------------------------
// Ahorcado
// ---------------------------------------------------------------------------

const wordCache = new Map<string, Palabra[]>();

/** Minúsculas, sin tildes; la ñ se trata como n para adivinar letra a letra. */
export function normalizeWord(text: string): string {
  return normalizeText(text).replace(/[^a-z]/g, '');
}

function isPalabra(value: unknown): value is { palabra: string; pista: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.palabra !== 'string' || typeof v.pista !== 'string') return false;
  const word = normalizeWord(v.palabra);
  return word.length >= 3 && word.length <= 15 && v.pista.trim().length > 3 && !normalizeText(v.pista).includes(word);
}

export function localWord(categoria: string | undefined): Palabra {
  const key = cacheKey(categoria);
  const byCat = PALABRAS.filter((p) => key !== 'general' && (p.categoria === key || normalizeText(p.categoria).includes(key)));
  return pickOne(byCat.length > 0 ? byCat : PALABRAS);
}

async function fillWordCache(key: string): Promise<void> {
  const categoria = key === 'general' ? 'temas variados' : key;
  const { askJSON } = await loadAI();
  const batch = await askJSON<unknown[]>({
    system: 'Generas palabras para el juego del ahorcado en español. '
      + 'Devuelve un arreglo JSON de objetos {"palabra": string (una sola palabra, sin espacios, 4-12 letras), "pista": string corta que no contenga la palabra}.',
    user: `Genera ${BATCH} palabras de la categoría: ${categoria}.`,
    maxTokens: 800,
    effort: 'low',
  });
  if (!Array.isArray(batch)) return;
  const valid = batch.filter(isPalabra).map((p): Palabra => ({
    palabra: normalizeWord(p.palabra),
    pista: p.pista.trim(),
    categoria: (PALABRAS_CATEGORIAS as readonly string[]).includes(key) ? key as Palabra['categoria'] : 'objetos',
  }));
  const current = wordCache.get(key) ?? [];
  wordCache.set(key, [...current, ...valid].slice(-CACHE_LIMIT));
}

export async function nextWord(categoria: string | undefined): Promise<Palabra> {
  const key = cacheKey(categoria);
  if ((await loadAI()).isAIEnabled()) {
    try {
      if ((wordCache.get(key)?.length ?? 0) === 0) await fillWordCache(key);
      const cached = wordCache.get(key);
      if (cached && cached.length > 0) return cached.pop() as Palabra;
    } catch (error) {
      log.warn('ahorcado: fallo la IA, uso el banco local:', error);
    }
  }
  return localWord(categoria);
}
