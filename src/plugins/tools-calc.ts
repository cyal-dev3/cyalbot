import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { create, all, type MathJsInstance } from 'mathjs';
import type { PluginHandler } from '../types/message.js';

export const MAX_EXPRESSION_LENGTH = 200;
const EVAL_TIMEOUT_MS = 2_000;
/** Memoria del hilo de cálculo; una matriz gigante mata el hilo, no el bot. */
const WORKER_HEAP_MB = 256;
const WORKER_ROLE = 'calc-worker';

const math: MathJsInstance = create(all);
const evaluateUnrestricted = math.evaluate.bind(math);

function disabled(name: string): () => never {
  return () => {
    throw new Error(`La función ${name} está deshabilitada`);
  };
}

// Las expresiones del usuario no deben poder redefinir el entorno, volver a
// evaluar texto arbitrario ni cambiar la configuración compartida (config
// persiste entre llamadas y alteraría los resultados de todos los usuarios).
math.import(
  {
    import: disabled('import'),
    createUnit: disabled('createUnit'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    compile: disabled('compile'),
    config: disabled('config'),
    parser: disabled('parser'),
  },
  { override: true },
);

/**
 * Pasa a sintaxis de mathjs lo que la gente escribe a mano: "15% de 2400",
 * "×", "÷", comas decimales. La coma solo se toma como decimal entre dígitos y
 * cuando no separa argumentos o elementos de lista (max(3,5), [1,2,3]); el "%"
 * solo es porcentaje si no le sigue un número (10 % 3 sigue siendo módulo).
 */
export function preprocessExpression(input: string): string {
  return input
    .trim()
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d),(\d{1,2})(?![\d,)\]])/g, '$1.$2')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*de\s+/gi, '($1/100)*')
    .replace(/(\d+(?:\.\d+)?)\s*%(?!\s*\d)/g, '($1/100)');
}

export type CalcResult = { ok: true; result: string } | { ok: false; error: string };

function translateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const symbol = message.match(/Undefined symbol (\w+)/);
  if (symbol) return `No sé qué es "${symbol[1]}".`;
  const fn = message.match(/Undefined function (\w+)/);
  if (fn) return `No existe la función "${fn[1]}".`;
  if (/deshabilitada/.test(message)) return message;
  if (/Unexpected|Parenthesis|Value expected|Unexpected end/.test(message)) return 'La expresión no está bien formada.';
  if (/Division by zero/i.test(message)) return 'No se puede dividir entre cero.';
  return 'No pude calcular eso.';
}

/** Evalúa una expresión en un entorno sin import/evaluate/parse/config. Síncrona y sin tope de tiempo. */
export function calculate(expression: string): CalcResult {
  const expr = preprocessExpression(expression);
  if (!expr) return { ok: false, error: 'Escribe una expresión.' };
  if (expr.length > MAX_EXPRESSION_LENGTH) return { ok: false, error: `Máximo ${MAX_EXPRESSION_LENGTH} caracteres.` };
  try {
    const value: unknown = evaluateUnrestricted(expr);
    if (typeof value === 'function') return { ok: false, error: 'Eso es una función, no un valor.' };
    if (value === undefined) return { ok: false, error: 'La expresión no produce ningún valor.' };
    const text = math.format(value, { precision: 14 });
    if (text.length > 500) return { ok: false, error: 'El resultado es demasiado largo para mostrarlo.' };
    return { ok: true, result: text };
  } catch (error) {
    return { ok: false, error: translateError(error) };
  }
}

// ---------------------------------------------------------------------------
// Evaluación en un hilo aparte con tope de tiempo y de memoria
// ---------------------------------------------------------------------------

interface WorkerRequest {
  id: number;
  expression: string;
}

interface WorkerReply {
  id: number;
  result: CalcResult;
}

const TIMEOUT_RESULT: CalcResult = { ok: false, error: 'El cálculo tardó demasiado.' };
const CRASH_RESULT: CalcResult = { ok: false, error: 'El cálculo era demasiado grande para resolverlo.' };

let worker: Worker | null = null;
let nextId = 0;
const inflight = new Map<number, { resolve: (r: CalcResult) => void; timer: NodeJS.Timeout }>();

/**
 * El hilo se crea perezosamente y se reutiliza (cargar mathjs cuesta cientos
 * de ms); solo se reemplaza cuando hay que matarlo por tiempo o memoria.
 */
function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL(import.meta.url), {
    workerData: { role: WORKER_ROLE },
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  });
  created.on('message', (reply: WorkerReply) => settle(reply.id, reply.result));
  created.on('error', () => dropWorker(created, CRASH_RESULT));
  created.on('exit', () => dropWorker(created, CRASH_RESULT));
  created.unref();
  worker = created;
  return created;
}

function settle(id: number, result: CalcResult): void {
  const entry = inflight.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  inflight.delete(id);
  // Sin peticiones en vuelo el hilo no debe mantener vivo el proceso.
  if (inflight.size === 0) worker?.unref();
  entry.resolve(result);
}

/** Olvida (y termina) el hilo; las peticiones que esperaban reciben `result`. */
function dropWorker(which: Worker, result: CalcResult): void {
  if (worker !== which) return;
  worker = null;
  void which.terminate().catch(() => undefined);
  for (const id of [...inflight.keys()]) settle(id, result);
}

/**
 * Como calculate, pero en un worker_thread: si la expresión bloquea (matrices
 * enormes, primalidad de números gigantes) el hilo se termina al vencer el
 * plazo o al agotar su memoria y el bot sigue respondiendo.
 */
export function calculateWithTimeout(expression: string, timeoutMs = EVAL_TIMEOUT_MS): Promise<CalcResult> {
  const expr = preprocessExpression(expression);
  if (!expr) return Promise.resolve({ ok: false, error: 'Escribe una expresión.' });
  if (expr.length > MAX_EXPRESSION_LENGTH) return Promise.resolve({ ok: false, error: `Máximo ${MAX_EXPRESSION_LENGTH} caracteres.` });

  return new Promise<CalcResult>((resolve) => {
    const id = ++nextId;
    const active = getWorker();
    const timer = setTimeout(() => {
      settle(id, TIMEOUT_RESULT);
      dropWorker(active, TIMEOUT_RESULT);
    }, timeoutMs);
    inflight.set(id, { resolve, timer });
    active.ref();
    active.postMessage({ id, expression } satisfies WorkerRequest);
  });
}

/** Termina el hilo de cálculo si existe (apagado y tests). */
export async function stopCalcWorker(): Promise<void> {
  const active = worker;
  if (!active) return;
  worker = null;
  for (const id of [...inflight.keys()]) settle(id, CRASH_RESULT);
  await active.terminate().catch(() => undefined);
}

if (!isMainThread && parentPort && (workerData as { role?: string } | null)?.role === WORKER_ROLE) {
  const port = parentPort;
  port.on('message', (request: WorkerRequest) => {
    port.postMessage({ id: request.id, result: calculate(request.expression) } satisfies WorkerReply);
  });
}

export const calcPlugin: PluginHandler = {
  command: ['calc', 'calcular', 'calculadora', 'mat'],
  description: 'Calculadora: aritmética, porcentajes, funciones y unidades',
  category: 'herramientas',
  help: ['calc <expresión> - Calcula algo: 2^10, sqrt(144), 15% de 2400, 5 km to mi'],
  usage: ['calc 15% de 2400', 'calc sqrt(2) * pi', 'calc 72 degF to degC'],

  handler: async ({ m, text, usedPrefix }) => {
    const expression = text.trim() || m.quoted?.text?.trim() || '';
    if (!expression) {
      await m.reply(`Escribe la operación: *${usedPrefix}calc (12 + 8) * 3* o *${usedPrefix}calc 15% de 2400*`);
      return;
    }
    const outcome = await calculateWithTimeout(expression);
    if (!outcome.ok) {
      await m.reply(`❌ ${outcome.error}`);
      return;
    }
    await m.reply(`🧮 ${preprocessExpression(expression)} = *${outcome.result}*`);
  },
};
