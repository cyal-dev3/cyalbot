import { create, all, type MathJsInstance } from 'mathjs';
import type { PluginHandler } from '../types/message.js';

export const MAX_EXPRESSION_LENGTH = 200;
const EVAL_TIMEOUT_MS = 2_000;

const math: MathJsInstance = create(all);
const evaluateUnrestricted = math.evaluate.bind(math);

function disabled(name: string): () => never {
  return () => {
    throw new Error(`La función ${name} está deshabilitada`);
  };
}

// Las expresiones del usuario no deben poder redefinir el entorno ni volver a evaluar texto arbitrario.
math.import(
  {
    import: disabled('import'),
    createUnit: disabled('createUnit'),
    evaluate: disabled('evaluate'),
    parse: disabled('parse'),
    simplify: disabled('simplify'),
    derivative: disabled('derivative'),
    compile: disabled('compile'),
  },
  { override: true },
);

/** Pasa a sintaxis de mathjs lo que la gente escribe a mano: "15% de 2400", "×", "÷", comas decimales. */
export function preprocessExpression(input: string): string {
  return input
    .trim()
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/,(?=\d{1,2}(?:\D|$))/g, '.')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*de\s+/gi, '($1/100)*')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
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

/** Evalúa una expresión en un entorno sin import/evaluate/parse. Síncrona. */
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

/**
 * Como calculate, pero con tope de tiempo. La evaluación de mathjs es
 * síncrona, así que la carrera solo acota la espera del llamador: la promesa
 * resuelve con error si el cálculo sigue atascado al vencer el plazo.
 */
export function calculateWithTimeout(expression: string, timeoutMs = EVAL_TIMEOUT_MS): Promise<CalcResult> {
  const timeout = new Promise<CalcResult>((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'El cálculo tardó demasiado.' }), timeoutMs);
    t.unref();
  });
  const work = new Promise<CalcResult>((resolve) => setImmediate(() => resolve(calculate(expression))));
  return Promise.race([work, timeout]);
}

export const calcPlugin: PluginHandler = {
  command: ['calc', 'calcular', 'calculadora', 'mat'],
  description: 'Calculadora: aritmética, porcentajes, funciones y unidades',
  category: 'herramientas',
  help: ['calc <expresión> - Calcula algo: 2^10, sqrt(144), 15% de 2400, 5 km to m'],
  usage: ['calc 15% de 2400', 'calc sqrt(2) * pi', 'calc 100 usd to mxn'],

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
